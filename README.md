Overview
------

This is a playground of testing different LLMs and my daily LLM use cases. It is based on the [ggml](https://github.com/ggerganov/ggml) ML library, [llamacpp](https://github.com/ggerganov/llama.cpp) community and its python wrapper [llama-cpp-python](https://github.com/abetlen/llama-cpp-python). The scripts in the root directory is mainly served for a proof-of-concept purpose, originally forked from the low level api in llama-cpp-python, will test some functionalities already implemented in the main example of llamacpp or new features that could benefit my use cases.

Tasks
-------
- [x] add self-extend function in chat mode.  
- [x] implement and test page attention / parallel kv cache.
- [ ] test batch inference.

