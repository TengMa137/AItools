import sys
from langchain.embeddings import HuggingFaceInstructEmbeddings
from langchain.llms.llamacpp import LlamaCpp
from langchain.llms.openai import OpenAI
from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema import LLMResult
from typing import Any, Optional
import os

def load_llm(llm, api_key: Optional[str] = None, n_ctx=4096, n_gpu=20, n_threads=os.cpu_count()):
    """
    wrapper of llamacpp model, since llamacpp is under rapid development, 
    new introduced parameters could be passed to model_kwargs: Dict 
    after reinstall llama-cpp-python.
    openai model not tested.
    """
    if api_key:
        llm = OpenAI(model_name=llm, openai_api_key="YOUR_API_KEY", streaming=True)
    else:
        llm = LlamaCpp(model_path=llm, 
             n_threads=n_threads,
             max_tokens=512, 
             n_ctx=n_ctx,
             n_batch=64, 
             n_gpu_layers=n_gpu, 
             logits_all=True,
             stop=['<EOT>','</s>'],
             model_kwargs={"offload_kqv": True}
             )
    return llm

def get_embeddings(embedding_model, device_type='cpu'):
    """wrapper around embedding model"""
    embeddings_model = HuggingFaceInstructEmbeddings(
        model_name=embedding_model,
        model_kwargs={"device": device_type},
    )
    return embeddings_model

class StreamHandler(BaseCallbackHandler):
    """
    Handle the streaming output in streamlit container.
    """
    def __init__(self, container, initial_text=""):
        self.container = container
        self.text = ""

    def on_llm_new_token(self, token: str, **kwargs) -> None:
        sys.stdout.write(token)
        sys.stdout.flush()
        self.text += token
        self.container.write(self.text)

    def on_llm_end(self,response:LLMResult, **kwargs: Any) -> None:
        self.text = ""
