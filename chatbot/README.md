Chatbot
------

Use streamlit as front-end webpage engine, serving local gguf LLMs or remote openai models (api-key required) for now, will add more if necessary. Employ Langchain framework for extensive support of different dataloaders, faiss vector store for local embedding store and Retrieval-Augmented Generation (RAG). This chatbot is developed for personal usage, will integrate more functions that are interesting and useful to me. 

Now it supports normal chat, q&a over documents (txt,pdf,doc,docx) and local storage for all chats and text embeddings, I am trying to make it usable in cases like long context conversation or RAG over large documents, by speeding up the LLM inference and developing proper patterns for different use cases.
