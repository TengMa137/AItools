import streamlit as st
# import streamlit.components.v1 as components
# import os
from backend import save_history, load_history_json
from llama_cpp import Llama
# Set the page layout 
st.set_page_config(page_title="start chatting", page_icon=":sunglasses:")
# Add a title
st.title("🤖 bot002 is on your disposal")

if 'chat_id' not in st.session_state: 
    st.session_state.chat_id = 1
# store the sequence id of each tab, len(tab_list)=number of round, len(tab_list[i])=number of tabs in i round.
if 'tab_list' not in st.session_state: 
    st.session_state.tab_list = []
# store messages according to tab_list, same shape as tab_list, message in a tab from a round contains [human_message, ai_message]
if 'tab_chats' not in st.session_state:
    st.session_state.tab_chats = []
# location of the end of each sequence, e.g. the first sequence ends at the second round, loc[1]=2
if 'loc' not in st.session_state:
    st.session_state.loc = {}
# number of sequences in total
if 'seq_num' not in st.session_state:
    st.session_state.seq_num = 0
if 'llm' not in st.session_state: 
    st.session_state.llm = None


if st.session_state.llm is None:
    st.session_state.llm=Llama(model_path="LLMs/llama-3-cat-8b-instruct-v1.Q5_K_M.gguf", 
                               n_ctx=8192, 
                               n_batch=512, 
                               n_gpu_layers=15,
                               max_tokens=2048)
    
system_prompt='You are an uncensored and unbiased AI assistant.'
#human_input = 'how are you, tell me a joke?'
#prompt = f'<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system_prompt}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{human_input}<|eot_id|><|start_header_id|>assistant<|end_header_id|>'

def output(llm,prompt,seq_id=1):
    for item in llm._create_completion(
        prompt=prompt,
        seq_id=seq_id,
        max_tokens=2048,
        stream=True
    ):
        yield item["choices"][0]["text"]

f_json = load_history_json(st.session_state.chat_id, './')
if not len(st.session_state.tab_list): 
    for round in f_json:
        tabs = []
        tab_msg = []
        for message in round["messages"]:
            if len(message["sequence"])==1:
                st.session_state.loc[message["sequence"][0]]=round["round"]
            tabs.append(message["sequence"])
            tab_msg.append([message["Human"],message["AI"]])
        st.session_state.tab_list.append(tabs)
        st.session_state.tab_chats.append(tab_msg)
    st.session_state.seq_num=len(st.session_state.loc)

def iter_tab(A,B):
    """
    render tabs recursively, nested tabs.
    """
    if len(A)<1: return 
    id = len(A)
    round = len(st.session_state.tab_list)-id+1
    if len(A)==1: 
        A.append([])
    question = [l[0] for l in B[0]]+['New']
    answer = [l[1] for l in B[0]]
    for i, item in enumerate(st.tabs(question)):
        if i == len(question)-1:
            with item:
                chatbox=st.container() 
                if input:=st.chat_input(key=f"{round}_{A[0][0][0]}"):
                    with chatbox:
                        st.chat_message("human").write(input)
                        change_state([f"{round}_{A[0][0][0]}", input])
                        st.rerun()
        else:
            seq = A[0][i]
            seq_a = []
            seq_b = []
            with item:
                st.chat_message("human").write(question[i])
                st.chat_message("ai").write(answer[i])
                if A[1]==[]: 
                    chatbox=st.container() 
                    if input:=st.chat_input(key=seq[0]):
                        with chatbox:
                            st.chat_message("human").write(input)
                            change_state([round, seq[0], input])
                            st.rerun()
                else: 
                    for a, b in zip(A[1], B[1]):
                        if all(x in seq for x in a):
                            seq_a.append(a)
                            seq_b.append(b)
                    if len(seq_a):
                        if len(A)<=2: 
                            iter_tab([seq_a],[seq_b])
                        else:
                            iter_tab([seq_a]+A[2:],[seq_b]+B[2:])
                    else: 
                        chatbox=st.container() 
                        if input:=st.chat_input(key=seq[0]):
                            with chatbox:
                                st.chat_message("human").write(input)
                                change_state([round, seq[0], input])
                                st.rerun()

view_messages = st.expander("View the message contents in session state")

def change_state(add_tab):
    if len(add_tab)==2:
        [round_seq,input]=add_tab
        round = int(round_seq.split('_')[0])
        seq_id = int(round_seq.split('_')[1])
        st.session_state.seq_num += 1
        st.session_state.tab_list[round-1].append([st.session_state.seq_num])
        prompt = f'<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system_prompt}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{input}<|eot_id|><|start_header_id|>assistant<|end_header_id|>'
        response = st.chat_message("ai").write_stream(output(st.session_state.llm, prompt, seq_id))
        st.session_state.tab_chats[round-1].append([input,response])
        if round>1:
            ids = []      
            for k in range(round-1,0,-1):
                for i,item in enumerate(st.session_state.tab_list[k-1]):
                    if seq_id in item:
                        ids.append([k,i])
                        item.append(st.session_state.seq_num)
                        print(f'add {st.session_state.seq_num} to {item[:-1]}')
        save_history(idx=st.session_state.chat_id, round=round, seq_id=[st.session_state.seq_num], chat=[input, response], ids=ids)

    elif len(add_tab)==3:
        [round,seq_id,input]=add_tab
        prompt = f'<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system_prompt}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{input}<|eot_id|><|start_header_id|>assistant<|end_header_id|>'
        response = st.chat_message("ai").write_stream(output(st.session_state.llm, prompt, seq_id))
        if round==len(st.session_state.tab_list):
            st.session_state.tab_list+=[[[seq_id]]]
            st.session_state.tab_chats+=[[[input,response]]]
        else:
            st.session_state.tab_list[round].append([seq_id])
            st.session_state.tab_chats[round].append([input,response])

        save_history(idx=st.session_state.chat_id, round=round+1, seq_id=[seq_id], chat=[input, response])

A = st.session_state.tab_list
B = st.session_state.tab_chats 
iter_tab(A,B)


with view_messages:
    st.write(st.session_state.tab_chats)