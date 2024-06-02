# Get file content and generate embeddings (extensible, check langchain various file loaders).
# import logging
import os

from langchain.docstore.document import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter, CharacterTextSplitter
from langchain.vectorstores.faiss import FAISS
from langchain.document_loaders.pdf import PyMuPDFLoader
from langchain.document_loaders.text import TextLoader
from langchain.document_loaders.word_document import UnstructuredWordDocumentLoader
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import EmbeddingsFilter
from langchain.document_transformers import EmbeddingsRedundantFilter
from langchain.retrievers.document_compressors import DocumentCompressorPipeline

from utils import get_embeddings
from default_paths import (
    EMBEDDING_MODEL_NAME,
    FILE_UPLOAD,
    EMBEDDING_SAVE
)

if not os.path.exists(FILE_UPLOAD): os.mkdir(FILE_UPLOAD)
if not os.path.exists(EMBEDDING_SAVE): os.mkdir(EMBEDDING_SAVE)

# logger = logging.getLogger(__name__)
# logging.basicConfig(filename='example.log', encoding='utf-8', level=logging.DEBUG)

DOCUMENT_MAP = {
    # ".html": UnstructuredHTMLLoader,
    # ".md": UnstructuredMarkdownLoader,
    ".txt": TextLoader,
    ".pdf": PyMuPDFLoader,
    ".doc": UnstructuredWordDocumentLoader,
    ".docx": UnstructuredWordDocumentLoader,
}


def load_single_document(file_path: str) -> Document:
    # Loads a single document from a file path
    try:
        file_extension = os.path.splitext(file_path)[1]
        loader_class = DOCUMENT_MAP.get(file_extension)
        if loader_class:
            #logger.info(f"Loaded {file_path}")
            loader = loader_class(file_path)
        else:
            #logger.info(f"{file_path}: File type is not supported yet.")
            raise ValueError("File type is not supported yet")
        return loader.load()
    except Exception as ex:
        #logger.info(f"{file_path} loading error: \n{ex}")
        return None


def scan_docs(file_path: str) -> list[str]:
    files = []
    for item in os.scandir(file_path):
        if item.is_file():
            files.append(item.path)
    return files
    
        
def load_new_documents(file_path: str, embedding_path: str) -> list[Document]:
    # find new files without embeddings saved locally 
    docs = []
    files = scan_docs(file_path)
    embedded_files = scan_docs(embedding_path)
    for file in files:
        if file not in embedded_files:
            doc = load_single_document(file)
            docs.append(doc)
    return docs


def embed_docs(device_type, chunk_size = 2000): 
    # Load documents and split in chunks
    # logger.info(f"Loading documents from {FILE_UPLOAD}")
    documents = load_new_documents(FILE_UPLOAD, EMBEDDING_SAVE)
    text_splitter = RecursiveCharacterTextSplitter(chunk_size = chunk_size, chunk_overlap = 200, separators="\n")
    for doc in documents:
        doc_chunks = text_splitter.split_documents(doc)
        embeddings = get_embeddings(EMBEDDING_MODEL_NAME, device_type)
        file_path = doc[0].metadata['source']
        #logger.info(f"Loaded embeddings from {file_path}")
        db = FAISS.from_documents(doc_chunks, embeddings)
        db.save_local(EMBEDDING_SAVE+'/'+file_path.split('/')[-1])
    return db

def retrieve_documents(db, embeddings, chunk_size = 400, retrieve_pieces=5):
    # compress documents to save resources
    retriever = db.as_retriever(search_type="mmr",search_kwargs={'k': retrieve_pieces})
    splitter = CharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=0, separator=". ")
    redundant_filter = EmbeddingsRedundantFilter(embeddings=embeddings)
    relevant_filter = EmbeddingsFilter(embeddings=embeddings, similarity_threshold=0.76, k=retrieve_pieces) #k=5) #similarity_threshold=0.76)
    pipeline_compressor = DocumentCompressorPipeline(
        transformers=[splitter, redundant_filter, relevant_filter]
    )
    compression_retriever = ContextualCompressionRetriever(base_compressor=pipeline_compressor, base_retriever=retriever)
    return compression_retriever
