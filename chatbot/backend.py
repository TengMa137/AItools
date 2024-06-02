import json
import os
from typing import Dict, List
from langchain.text_splitter import _split_text_with_regex
from langchain.schema.chat_history import BaseChatMessageHistory
from langchain.vectorstores.faiss import FAISS

def load_sum(dir: str) -> Dict:
    """
    load summary of the first round of each chat.
    """
    if os.path.exists(dir+"chats_summary.json"):
        with open(dir+"chats_summary.json", "r") as file:
            try:
                # Read the JSON content
                data = json.load(file)
                # print(data)
                return data
            except json.JSONDecodeError as e:
                print("Error while parsing JSON:", str(e)) 
    else: 
        with open("chats_summary.json","w") as file:
            return {} 


def save_sum(idx: int, msg: str, summary: dict) -> None:
    if summary is None: summary = {}
    summary[f"chat_{idx}"] = msg.strip(' \n')+'\n'
    with open("chats_summary.json","w") as file:
        json.dump(summary,file)

        
def load_history(idx: int, msg: BaseChatMessageHistory, memo_path: str = './memory/') -> BaseChatMessageHistory:
    """
    load chat history that exist in ./memory folder.
    """
    if not os.path.exists(memo_path): 
        os.mkdir(memo_path)
        return msg
    with open(memo_path+f"{idx}.txt", "r") as file:
        f = file.read()
        splits = _split_text_with_regex(f, "Human: |AI: ", keep_separator=True)
        #print(len(splits))
        for i, line in enumerate(splits):
            if i%2==0:
                #print(line[7:])
                msg.add_user_message(line[7:])
            else:
                msg.add_ai_message(line[4:])
    return msg
    

def save_history(idx: int, chat: List[str], memo_path: str):
    if not os.path.exists(memo_path):
         os.mkdir(memo_path)
    elif not os.path.isdir(memo_path):
         raise ValueError(
            "Not a valid path for chat history."
        )
    with open(memo_path + f"{idx}.txt", 'a+') as file:
        file.write("Human: "+chat[-2].content.strip('\n')+"\n")
        file.write("AI: "+chat[-1].content.strip('\n')+"\n")

def save_history_db(idx: int, memo_path: str, embeddings):
    with open(memo_path+f"{idx}.txt", "r") as file:
        f = file.read()
        splits = _split_text_with_regex(f, "Human: ", keep_separator=True)    
        print(len(splits))   
        db = FAISS.from_texts(splits, embeddings)
        db.save_local("faiss_index/"+f"{idx}")