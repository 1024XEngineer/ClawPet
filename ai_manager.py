"""
AI 管理器 - 支持多种 AI 后端
API Key 通过环境变量配置，不要硬编码！
"""
import os
import json
import subprocess
import threading
from PyQt5.QtCore import QObject, pyqtSignal


class AIBackend:
    """AI 后端基类"""
    
    def ask(self, text, system_prompt, history):
        raise NotImplementedError


class ZhipuBackend(AIBackend):
    """智谱 AI 后端 (BigModel) - GLM-4-Flash 免费模型"""
    
    def __init__(self):
        from openai import OpenAI
        api_key = os.environ.get("ZHIPU_API_KEY", "")
        if not api_key:
            raise ValueError("ZHIPU_API_KEY 环境变量未设置，请查看 .env.example")
        
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://open.bigmodel.cn/api/paas/v4/",
        )
    
    def ask(self, text, system_prompt, history):
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history[-6:])
        messages.append({"role": "user", "content": text})
        
        response = self.client.chat.completions.create(
            model="glm-4-flash",
            messages=messages,
            max_tokens=150,
            temperature=0.8,
        )
        
        if response.choices:
            content = response.choices[0].message.content
            if content:
                return content.strip()
        return None


class PicoClawBackend(AIBackend):
    """PicoClaw 后端"""
    
    def __init__(self):
        self.script_dir = os.path.dirname(os.path.abspath(__file__))
        self.picoclaw_path = os.path.join(self.script_dir, "picoclaw.exe")
        self.picoclaw_home = os.path.join(self.script_dir, "picoclaw_data")
    
    def _call_agent(self, context):
        """调用 PicoClaw Agent"""
        try:
            cmd = [
                "powershell", "-Command",
                f"$env:PICOCLAW_HOME='{self.picoclaw_home}'; & '{self.picoclaw_path}' agent -m '{context}'"
            ]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=60,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            
            output = result.stdout.decode('utf-8', errors='ignore') if result.stdout else ""
            
            for line in reversed(output.split('\n')):
                clean = line.strip()
                if not clean or clean.startswith('[') or clean.startswith('12:'):
                    continue
                if any(c in clean for c in ['╚', '╔', '═', '█', '🦞']):
                    continue
                return clean
            
            return None
        except Exception as e:
            print(f"PicoClaw error: {e}")
            return None
    
    def ask(self, text, system_prompt, history):
        context = f"{system_prompt}\n\n# 对话历史\n"
        for msg in history[-6:]:
            role = "用户" if msg["role"] == "user" else "助手"
            context += f"{role}: {msg['content']}\n"
        context += f"\n用户: {text}\n助手:"
        
        return self._call_agent(context)


class AIManager(QObject):
    """AI 管理器"""
    
    reply_signal = pyqtSignal(str, bool)
    
    def __init__(self, memory=None):
        super().__init__()
        
        self.backends = {
            "zhipu": ZhipuBackend(),
            "picoclaw": PicoClawBackend(),
        }
        self.current_backend = "picoclaw"
        
        self.chat_history = []
        self.is_thinking = False
        self.memory = memory
        
        from character_system import get_current_character
        self.character = get_current_character()
    
    def set_backend(self, name):
        """切换 AI 后端"""
        if name in self.backends:
            self.current_backend = name
            return True
        return False
    
    def refresh_character(self):
        """重新加载角色"""
        from character_system import get_current_character
        self.character = get_current_character()
        self.chat_history.clear()
    
    def get_system_prompt(self):
        return self.character.build_system_prompt()
    
    def ask(self, text):
        if self.is_thinking:
            return
        self.is_thinking = True
        threading.Thread(target=self._ask_thread, args=(text,), daemon=True).start()
    
    def _ask_thread(self, text):
        reply = ""
        is_error = False
        
        try:
            memory_context = self.memory.get_memory_context() if self.memory else ""
            
            system_prompt = self.get_system_prompt()
            if memory_context:
                system_prompt += f"\n\n【主人相关记忆】\n{memory_context}"
            
            backend = self.backends.get(self.current_backend)
            if backend:
                reply = backend.ask(text, system_prompt, self.chat_history)
            
            if reply:
                self.chat_history.append({"role": "user", "content": text})
                self.chat_history.append({"role": "assistant", "content": reply})
            else:
                is_error = True
                reply = "AI回复为空"
                
        except Exception as e:
            reply = f"出错了: {str(e)[:80]}"
            is_error = True
        finally:
            self.is_thinking = False
            self.reply_signal.emit(reply, is_error)
