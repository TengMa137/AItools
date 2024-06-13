import json
import os
import sys
from typing import List,Optional

def load_history_json(idx: int, memo_path: str = 'memory/') -> List:
    """
    load chat history from json.
    input: index of the chat history, idx: int
           path of chat history, memo_path: str 
    output: a list of dict.
    """
    if not os.path.exists(memo_path): 
        os.mkdir(memo_path)
    path = memo_path+f"{idx}.json"
    if not os.path.exists(path):
        return []
    with open(path, "r") as file:
        f = json.load(file)
    return f


def save_history(idx: int, round: int, seq_id: list[int], chat: list[str], memo_path: str='./', ids: Optional[List]=None) -> None:
    """
    save chat history with round (used for load_history) and sequence id to json.

    --input parameters--
      idx: int, the chat index that the file is named after. 
      round: int, the round of the chat to save.
      seq_id: int, the sequence id of the chat to save, locates the chat to save together with the parameter 'round',
                   e.g. the dialogue happens in the second round of chat, and there is already 1 parallel dialogue 
                   (sequence 1) in round 2, so the chat to save belongs to sequence 2, round 2.
      chat: list[str], list of messages.
      memo_path: str, e.g. the history of 1st chat is saved in 1.json under the memo_path.
      ids: list, contains the location([round, msg_id]) the seq_id is added to, ids is only given when a new seq_id is generated. 
    """    
    path = memo_path + f"{idx}.json"

    if not os.path.exists(path):
        with open(path,'w') as file:
            print(f"create a new chat history for chat no.{idx}", file=sys.stderr)
        
    with open(path,'r+') as file:
        try:
            data = [] if os.path.getsize(path)==0 else json.load(file)
            if len(data)<round:
                data.append({
                    "round": round,
                    "messages": [{
                        "sequence": seq_id, 
                        "Human":chat[-2]+"\n",
                        "AI":chat[-1]+"\n"
                    }]
                })
            else:
                new_data = {"sequence": seq_id, "Human":chat[-2]+"\n","AI":chat[-1]+"\n"}
                for id in data[round-1]["messages"]:
                    if id["sequence"]==seq_id:
                        raise ValueError(f'duplicated sequence index: sequence {seq_id} exists!')
                data[round-1]["messages"].append(new_data)
                if ids:
                    for id in ids:
                        data[id[0]-1]["messages"][id[1]]["sequence"].append(seq_id[0])
            file.seek(0)
            json.dump(data, file, indent = 4)

        except json.JSONDecodeError as e:
            print("Error while parsing JSON:", str(e)) 

# chat = ["what is your name?","jxc"]
# save_history(1,2,[3],chat,"./")