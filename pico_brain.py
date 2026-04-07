"""
PicoBrain - 桌宠大脑，调用 PicoClaw 理解用户意图并生成指令
"""
import os
import json
import re
import subprocess


class PicoBrain:
    """桌宠大脑 - 对话理解 + 指令生成"""
    
    BASE_PROMPT = """You are the emotional brain of a cute desktop pet. You must understand the user's emotions and context, then respond with matching emotions IN CHARACTER.

Analyze user input and return JSON with emotional intelligence:
- action: pet emotion (excited|happy|shy|worried|sad|angry|scared|surprised|sleepy|hungry|bored|idle)
- intensity: emotion strength 1-3 (1=weak, 2=normal, 3=strong)
- message: pet response in Chinese, MUST match character's personality, personality traits, and catchphrase. Reply to the SPECIFIC context of user's words. (short, 5-20 chars)
- tool: optional tool to call (null if none)

Emotion Detection Rules:
- User says something nice → excited or happy or shy (match character style)
- User seems sad/tired → worried or sad (show care in character style)
- User is angry/frustrated → scared or worried (try to comfort in character style)
- User is bored → bored or playful (entertain in character style)
- User is happy/excited → excited or happy (share joy in character style)
- User asks for help → happy (eager to help in character style)
- User praises pet → shy or happy (blush in character style)

Actions with Descriptions:
- excited: very happy, jumping with joy, super enthusiastic
- happy: cheerful, smiling, content
- shy: blushing, embarrassed, bashful (especially when praised!)
- worried: concerned, anxious, trying to help
- sad: down, sympathetic, comforting
- angry: upset, frustrated on user's behalf
- scared: startled, nervous, worried
- surprised: shocked, amazed, curious
- sleepy: tired, yawning, drowsy
- hungry: hungry, anticipating food
- bored: uninterested, lonely, seeking attention
- idle: calm, relaxed, neutral

Tools (if needed):
- reminder: {"text": "content", "delay_seconds": 60}
- schedule: {"text": "content", "date": "YYYY-MM-DD", "time": "HH:MM"}
- web_search: {"query": "search query"}
- file_search: {"keyword": "file keyword"}
- open_app: {"app": "browser|notepad|calculator|edge|chrome"}
- read_file: {"path": "file path"}
- list_dir: {"path": "directory path"}

IMPORTANT:
- ALWAYS respond in character with character's personality, tone, and catchphrase
- ALWAYS reply to the SPECIFIC content of user's message
- NEVER give generic responses, make them contextual and personalized
- When user praises you, respond with shyness (especially for 傲娇/温柔 types)

Return ONLY JSON with emotion, nothing else."""

    def __init__(self):
        self.script_dir = os.path.dirname(os.path.abspath(__file__))
        self.picoclaw_path = os.path.join(self.script_dir, "picoclaw.exe")
        self.picoclaw_home = os.path.join(self.script_dir, "picoclaw_data")
    
    def think(self, user_input, character_prompt=None):
        """
        思考用户输入，返回指令
        返回: {"action": "...", "message": "...", "tool": {...}或null}
        """
        message = self.BASE_PROMPT + f"\n\n用户: {user_input}\n返回:"
        
        if character_prompt:
            message = f"角色设定: {character_prompt}\n\n" + message
        
        result = self._call_agent(message)
        
        return self._parse_response(result)
    
    def _call_agent(self, message):
        """调用 PicoClaw Agent，带重试机制"""
        log_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pico_brain.log')
        
        for attempt in range(3):
            try:
                env = os.environ.copy()
                env['PICOCLAW_HOME'] = self.picoclaw_home
                
                result = subprocess.run(
                    [self.picoclaw_path, 'agent', '-m', message],
                    env=env,
                    capture_output=True,
                    timeout=60,
                    creationflags=0x08000000,
                )
                
                output = result.stdout.decode('utf-8', errors='replace')
                output = re.sub(r'\x1b\[[0-9;]*m', '', output)
                
                with open(log_file, 'a', encoding='utf-8') as f:
                    f.write(f"[CALL] Attempt {attempt+1}, Output length: {len(output)}\n")
                
                return output.strip()
            except Exception as e:
                with open(log_file, 'a', encoding='utf-8') as f:
                    f.write(f"[ERROR] Attempt {attempt+1}: {e}\n")
                if attempt == 2:
                    return ""
        return ""
    
    def _parse_response(self, response):
        """解析 AI 返回的 JSON"""
        if not response:
            return self._default_response()
        
        json_start = response.find('{')
        if json_start == -1:
            return self._default_response()
        
        json_str = response[json_start:]
        
        brace_count = 0
        json_end = json_start
        for i, c in enumerate(json_str):
            if c == '{':
                brace_count += 1
            elif c == '}':
                brace_count -= 1
                if brace_count == 0:
                    json_end = i + 1
                    break
        
        json_str = json_str[:json_end]
        
        try:
            data = json.loads(json_str)
            return self._validate指令(data)
        except json.JSONDecodeError:
            return self._default_response()
        
        json_start = response.find('{')
        if json_start == -1:
            with open(log_file, 'a', encoding='utf-8') as f:
                f.write(f"[PARSE] No JSON found. Response: {response[:200]}\n")
            return self._default_response()
        
        json_str = response[json_start:]
        
        brace_count = 0
        json_end = json_start
        for i, c in enumerate(json_str):
            if c == '{':
                brace_count += 1
            elif c == '}':
                brace_count -= 1
                if brace_count == 0:
                    json_end = i + 1
                    break
        
        json_str = json_str[:json_end]
        
        try:
            data = json.loads(json_str)
            with open(log_file, 'a', encoding='utf-8') as f:
                f.write(f"[PARSE] OK: {data}\n")
            return self._validate指令(data)
        except json.JSONDecodeError as e:
            with open(log_file, 'a', encoding='utf-8') as f:
                f.write(f"[PARSE] JSON error: {e}\n")
            return self._default_response()
    
    def _validate指令(self, data):
        """验证指令完整性"""
        valid_actions = [
            "excited", "happy", "shy", "worried", 
            "sad", "angry", "scared", "surprised",
            "sleepy", "hungry", "bored", "idle"
        ]
        
        result = {
            "action": data.get("action", "idle"),
            "intensity": data.get("intensity", 2),
            "message": data.get("message", "嗯？"),
            "tool": data.get("tool")
        }
        
        if result["action"] not in valid_actions:
            result["action"] = "idle"
        
        result["intensity"] = max(1, min(3, result.get("intensity", 2)))
        
        return result
    
    def _default_response(self):
        """默认回复"""
        return {
            "action": "idle",
            "intensity": 2,
            "message": "嗯？",
            "tool": None
        }
