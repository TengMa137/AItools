import streamlit as st
import streamlit.components.v1 as components
from langchain.chains import LLMChain
from langchain.memory.chat_message_histories import StreamlitChatMessageHistory
from langchain.prompts import PromptTemplate
from langchain.memory import VectorStoreRetrieverMemory, CombinedMemory, ConversationBufferWindowMemory
from langchain.vectorstores.faiss import FAISS
from langchain.text_splitter import _split_text_with_regex
import os, gc
from backend import load_history, save_history, load_sum, save_sum
from prompt_templates import combo_template, base_template, sum_template, parse_prompts, file_template
from utils import get_embeddings, load_llm, StreamHandler
from file2embeddinds import embed_docs,retrieve_documents,scan_docs
from default_paths import (
    EMBEDDING_MODEL_NAME,
    LLAMA3_8b,
    CODE_LLAMA3_8b,
    CODE_Phi3_128k,
    Phi3_128k,
    MISTRAL_7b,
    # MISTRAL_dolphin_dpo_laser_7b,
    # Sakura_SOLAR,
    CHATS,
    CHAT_SUM,
    FILE_UPLOAD,
    EMBEDDING_SAVE
)
from dotenv import load_dotenv
load_dotenv()
# api_key = os.environ.get("api_key")
# Set the page layout 
st.set_page_config(page_title="Streamlit chatbot", page_icon=":sunglasses:")
# Add a title
st.title("🤖 bot001 is on your disposal")

# Add a sidebar
tab1, tab2 = st.sidebar.tabs(["Chats", "Settings"])

if "llm" not in st.session_state: st.session_state.llm=None
if "idx" not in st.session_state: st.session_state.idx=0
if "retriever" not in st.session_state: st.session_state.retriever=None
if "db_chats" not in st.session_state: st.session_state.db_chats=None
if "db_files" not in st.session_state: st.session_state.db_files=None
if "embeddings" not in st.session_state: st.session_state.embeddings=None

if st.session_state.embeddings is None: st.session_state.embeddings = get_embeddings(EMBEDDING_MODEL_NAME)

# clear Vram if model is changed.
def _clear_ram():     
    if st.session_state.llm is None: return
    with st.spinner("clearing ram..."):
        st.session_state.llm.del_llm()
        del st.session_state.llm
        gc.collect()

models_list = ('-','Llama3-8b','Phi3-code-128k', 'Llama3-code-8b', 'mistral-7b', 'Phi3-128k','chatgpt','gpt4')
with tab1:
    selected_model = st.selectbox("Select Model to load", models_list,index=0,on_change=_clear_ram)

if st.session_state.llm is None: 
    match selected_model:
        case 'Llama3-8b':
            st.session_state.llm = load_llm(LLAMA3_8b,1024,14) 
        case 'Llama3-code-8b':
            st.session_state.llm = load_llm(CODE_LLAMA3_8b,16384, 5) 
        case 'Phi3-code-128k':
            st.session_state.llm = load_llm(CODE_Phi3_128k,2048,33) 
        case 'mistral-7b':
            st.session_state.llm = load_llm(MISTRAL_7b, 2048, 16) 
        case 'Phi3-128k':
            st.session_state.llm = load_llm(Phi3_128k, 2048, 33)
        # case 'solar-10.7b':
        #     st.session_state.llm = load_llm(Sakura_SOLAR, 2048, 16)
        # case 'dolphin_7b':
        #     st.session_state.llm = load_llm(MISTRAL_dolphin_dpo_laser_7b,2048,20)
        case 'chatgpt':
            st.session_state.llm = load_llm("gpt-3.5-turbo-instruct", api_key=os.environ.get("api_key"))
        case 'gpt-4':
            st.session_state.llm = load_llm("gpt-4",api_key=os.environ.get("api_key"))
    
with tab2:
    st.subheader('chat_config')
    memory_window = st.slider('memory_window', 0, 10, 0)
    #retrieve_window = st.slider('retrieve_window', 0, 10, 2)
    st.subheader('file_config')
    chunk_size = st.number_input('chunk_size', max_value=5000, min_value=0, step=100, value=2000)
    retrieve_pieces = st.slider('retrieve_pieces', 0, 10, 2)
    compressed_chunk_size = st.number_input('compressed_chunk_size', max_value=1000, min_value=0, step=100, value=400)
    compressed_retrieve_pieces = st.slider('compressed_retrieve_pieces', 0, 10, 3)

# clear session state after chats switch 
def _clear_history():
    st.session_state.langchain_messages = []
    st.session_state.db_chats.save_local("faiss_index/"+f"{chat_index}")
    st.session_state.db_chats = None
    return

# Sidebar for selecting the conversation
chats_sum = load_sum(CHAT_SUM)
if chats_sum is not None:
    num_chats = len(chats_sum) 
    options = (["New conversation"]+[chats_sum[f"chat_{i+1}"] for i in range(num_chats)]) 
else:
    num_chats = 0
    chats_sum = {}
    options = (["New conversation"])

# get embedded files
file_list = ([item.name for item in os.scandir(EMBEDDING_SAVE)])

# clear session state db_files after multiselect change 
def _clear_embedding():
    st.session_state.db_files = None
    return

with tab1:
    selected_tab = st.selectbox("Select Conversation", options, index=st.session_state.idx, key="selected_tab", on_change=_clear_history)
    st.subheader("Your files")
    selected_files = st.multiselect("Choose one or more files to continue", file_list, placeholder='-',on_change=_clear_embedding)

    files = st.file_uploader("Upload your PDFs here", accept_multiple_files=True)
    for file in files:
        save_path = FILE_UPLOAD+'/'+file.name
        with open(save_path, mode='wb') as w:
            w.write(file.getvalue())      
        if save_path.exists():
            st.success(f'File {file.name} is successfully saved at {save_path}!')

    # embedding pdf. for pdf more than 20 pages, embedding first using GPU before run webapp.
    if st.button("Process"):                
        for index, file in enumerate(selected_files):
            # merge all selected files into one vertorstore, save in the session_state.
            if index == 0:
                st.session_state.db_files = FAISS.load_local(EMBEDDING_SAVE+"/"+file, st.session_state.embeddings)
            else:
                st.session_state.db_files.merge_from(FAISS.load_local(EMBEDDING_SAVE+"/"+file, st.session_state.embeddings))
        if files is None and st.session_state.db_files is None:
            st.write("please upload a file first.")
        elif set(scan_docs(FILE_UPLOAD))!=set(scan_docs(EMBEDDING_SAVE)):
            st.session_state.db_files.merge_from(embed_docs('cpu',chunk_size=chunk_size))
        st.session_state.retriever = retrieve_documents(st.session_state.db_files, st.session_state.embeddings,chunk_size=compressed_chunk_size, retrieve_pieces=compressed_retrieve_pieces)
            
chat_index = options.index(selected_tab)
# Set up memory
msgs = StreamlitChatMessageHistory(key="langchain_messages")

if st.session_state.db_chats is None:
    # for new conv, initialize db_chats; for existed chats, load local db
    if chat_index==0 or not os.path.exists("faiss_index/"+f"{chat_index}"): 
        st.session_state.db_chats = FAISS.from_texts(" ", st.session_state.embeddings)
    else: 
        st.session_state.db_chats = FAISS.load_local("faiss_index/"+f"{chat_index}", st.session_state.embeddings)

PROMPT = PromptTemplate(input_variables=["chat_history_lines", "human_input"], template=parse_prompts(selected_model,base_template))
PROMPT_db = PromptTemplate(input_variables=["context","history","chat_history_lines", "human_input"], template=parse_prompts(selected_model,file_template))
PROMPT_sum = PromptTemplate(input_variables=["human_input"], template=parse_prompts(selected_model,sum_template))
PROMPT_qa = PromptTemplate(input_variables=["history","chat_history_lines", "human_input"], template=parse_prompts(selected_model,combo_template))
# set memory
retriever_msg = st.session_state.db_chats.as_retriever(search_type="similarity", search_kwargs={'k': 1})
conv_memory = ConversationBufferWindowMemory(chat_memory=msgs, memory_key="chat_history_lines", input_key="human_input", k=memory_window)
vector_memory = VectorStoreRetrieverMemory(retriever=retriever_msg, memory_key="history", input_key="human_input",exclude_input_keys = ["chat_history_lines"])
memory = CombinedMemory(memories=[vector_memory, conv_memory])

view_messages = st.expander("View the message contents in session state")

# Render current messages from StreamlitChatMessageHistory
if len(msgs.messages) != 0:
    for msg in msgs.messages: st.chat_message(msg.type).write(msg.content)

if input := st.chat_input():
    #st.session_state.counter += 1
    if st.session_state.llm == None: 
        st.write("Choose a LLM before asking.")
        st.stop()
    st.chat_message("human").write(input)
    # # LLM warming up
    if len(msgs.messages) == 0 and chat_index == 0:
        with st.spinner("LLM is warming up...ingesting your question..."):
            llm_chain_sum = LLMChain(llm=st.session_state.llm,verbose=True,prompt=PROMPT_sum)
            condensed_question = llm_chain_sum.run(human_input=input)

    # Using different chains   
    if st.session_state.db_files:
        chunks = st.session_state.retriever.get_relevant_documents(input)
        context = ""
        # parsing the context, strip '\n' to make it compact.
        for i, chunk in enumerate(chunks):
            context = context + f'Provided text piece no.{i+1}: \n' + '\n'.join(chunk.page_content.strip('\n').split('\n\n'))+'\n'
        llm_chain = LLMChain(llm=st.session_state.llm,verbose=True, memory=memory, prompt=PROMPT_db)
        kwargs = {"human_input": input, "context": context}
    else:
        llm_chain = LLMChain(llm=st.session_state.llm, verbose=True, memory=memory, prompt=PROMPT_qa)
        kwargs = {"human_input": input}

    with st.chat_message("ai"):  
        callbacks = [StreamHandler(st.empty())]
        c1,c2,c3,c4 = st.columns([1,1,1,1])
        with c3:
            stop = st.button(":black_square_for_stop:", help="Stop generating tokens")
        response = llm_chain.invoke(kwargs,config={"callbacks": callbacks})
        if stop: st.stop()

    if chat_index == 0:
        st.session_state.idx = num_chats + 1
        save_sum(st.session_state.idx, condensed_question, chats_sum)
        save_history(st.session_state.idx, st.session_state.langchain_messages, CHATS)
        st.rerun()
    else:
        st.session_state.idx = chat_index
        save_history(chat_index, st.session_state.langchain_messages, CHATS)
        st.rerun()

# Draw the messages at the end, so newly generated ones show up immediately
with view_messages:
    """
    Memory initialized with:
    ```python
    msgs = StreamlitChatMessageHistory(key="langchain_messages")
    memory = ConversationBufferMemory(chat_memory=msgs)
    ```

    Contents of `st.session_state.langchain_messages`:
    """
    st.markdown(
        """
    <style>
    button {
        height: auto;
        padding-top: 5px !important;
        padding-bottom: 5px !important;
    }
    </style>
    """,
        unsafe_allow_html=True,
    )

    col1, col2 = st.columns([5,1])
    with col1:
        button1 = st.button('Clear',type="primary", help="Backup history message in vectorstore and clear memory")
    with col2:
        button2 = st.button('Restore',type="primary", help="Restore history message to display")

    if button1:
        with st.spinner("Saving chat history to vectorstore"): 
            convs = _split_text_with_regex(conv_memory.load_memory_variables({})["chat_history_lines"], "Human: ", keep_separator=True)  
            db_new = FAISS.from_texts(convs, st.session_state.embeddings)
            st.session_state.db_chats.merge_from(db_new)
            st.session_state.langchain_messages = []
            st.rerun()
    
    if button2:
        msgs = load_history(chat_index, msgs, CHATS)
        st.rerun()
            
    with st.empty():
        view_messages.json(st.session_state.langchain_messages)