# Context is King

Calls to LLMs are essentially stateless. The illusion of conversational memory is achieved by
passing all previous interactions as part of the message - generally refered to as the context.

For example, if I send the following message:

!!! quote "Steve (User)"
    Hello, my name is Steve.

you'll get something back like

!!! quote "Gemini (LLM)"
    Hello Steve! Nice to meet you.

If you then send the message <i>without any additional context</i>

!!! quote "Steve (User)"
	What's my name?

The LLM will reply with something like

!!! quote "Gemini (LLM)"
	I'm sorry, but I don't know your name. As an AI, I don't have access to personal information about you. You'd have to tell me!

This isn't what happens in your standard chat client; this is because the
chat doesn't really send only your most recent message. It's sending something like:

```json
[
  {"role": "user", "content": "Hello, my name is Steve"},
  {"role": "assistant", "content": "Hello Steve! Nice to meet you."},
  {"role": "user", "content": "What's my name?"}
]
```

In fact, we can check this by running the following:

```bash
curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  -H "Authorization: Bearer $YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [
      {"role": "user", "content": "Hello, my name is Steve"},
      {"role": "assistant", "content": "Hello Steve! Nice to meet you."},
      {"role": "user", "content": "What'\''s my name?"}
    ]
  }'
```
and now we get back...

!!! quote "Gemini (LLM)"
	Your name is Steve! How can I help you today?
	
[Download the JSON output](out.json)

The model was able to get the right answer by checking the context of the entire conversation.

No imagine you're having a really long converation; the total message size across <i>the entire conversation</i> is n**2

Managing context is probably the most important aspect of effective use of LLMs for long running tasks.

## Enter the Ralph loop

As conversations stretch out, attention dilutes, hallucinations creep in, and models hit the dreaded "dumb zone". 
The industry's crude fix has been context compaction—summarizing past chats into a blurry mess.  

Enter the Ralph loop: instead of forcing a single, bloated chat session to remember everything until it breaks, you treat context as disposable. 
You spin up a fresh agent instance for a single discrete task, let it read state from the file system (like a markdown spec or task list), execute, commit, and wipe the slate clean.  

Because context is king, sometimes the smartest move you can make is destroying it and starting fresh.
