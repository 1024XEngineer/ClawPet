"""
PicoTools - 工具执行器，只负责执行具体任务
"""
import os
import json
import re
import subprocess
import webbrowser
import urllib.parse
from datetime import datetime, timedelta


class PicoTools:
    """工具执行器"""
    
    def __init__(self, pet_window=None):
        self.pet_window = pet_window
        self.script_dir = os.path.dirname(os.path.abspath(__file__))
    
    def execute(self, tool):
        """
        执行工具
        tool: {"name": "...", "args": {...}} 或 None
        返回: 执行结果字符串 或 None
        """
        if not tool:
            return None
        
        name = tool.get("name")
        args = tool.get("args", {})
        
        executors = {
            "reminder": self._do_reminder,
            "schedule": self._do_schedule,
            "web_search": self._do_web_search,
            "file_search": self._do_file_search,
            "open_app": self._do_open_app,
            "read_file": self._do_read_file,
            "list_dir": self._do_list_dir,
            "exec": self._do_exec,
        }
        
        executor = executors.get(name)
        if executor:
            return executor(args)
        
        return None
    
    # ========== 提醒 ==========
    def _do_reminder(self, args):
        text = args.get("text", "提醒事项")
        delay = args.get("delay_seconds", 60)
        
        trigger = datetime.now() + timedelta(seconds=delay)
        
        reminder = {
            "id": int(datetime.now().timestamp()),
            "text": text,
            "trigger_time": trigger.strftime("%Y-%m-%d %H:%M:%S"),
            "done": False
        }
        
        file_path = os.path.join(self.script_dir, "reminders.json")
        reminders = []
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                reminders = json.load(f)
        reminders.append(reminder)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(reminders, f, ensure_ascii=False, indent=2)
        
        return f"已设置提醒: {text}"
    
    # ========== 日程 ==========
    def _do_schedule(self, args):
        text = args.get("text", "日程")
        date = args.get("date", datetime.now().strftime("%Y-%m-%d"))
        time_str = args.get("time", "09:00")
        
        schedule = {
            "id": int(datetime.now().timestamp()),
            "text": text,
            "date": date,
            "time": time_str,
            "done": False
        }
        
        file_path = os.path.join(self.script_dir, "schedules.json")
        schedules = []
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                schedules = json.load(f)
        schedules.append(schedule)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(schedules, f, ensure_ascii=False, indent=2)
        
        return f"已添加日程: {date} {time_str} - {text}"
    
    # ========== 网页搜索 ==========
    def _do_web_search(self, args):
        query = args.get("query", "")
        if not query:
            return "搜索内容不能为空"
        
        try:
            url = f"https://www.bing.com/search?q={urllib.parse.quote(query)}"
            webbrowser.open(url)
            return f"已打开浏览器搜索: {query}"
        except Exception as e:
            return f"搜索失败: {e}"
    
    # ========== 文件搜索 ==========
    def _do_file_search(self, args):
        keyword = args.get("keyword", "")
        if not keyword:
            return "搜索关键词不能为空"
        
        try:
            ps = f"Get-ChildItem -Path $env:USERPROFILE -Filter '*{keyword}*' -Recurse -File -EA SilentlyContinue | Select -First 5 FullName, Length | ConvertTo-Json"
            
            result = subprocess.run(
                ["powershell", "-Command", ps],
                capture_output=True,
                timeout=20,
                creationflags=0x08000000,
            )
            
            output = result.stdout.decode('utf-8', errors='ignore').strip()
            
            if not output or output == "null":
                return f"未找到包含 '{keyword}' 的文件"
            
            files = json.loads(output)
            if isinstance(files, dict):
                files = [files]
            
            if not files:
                return f"未找到包含 '{keyword}' 的文件"
            
            results = []
            for f in files[:5]:
                name = f.get('FullName', '未知')
                size = f.get('Length', 0)
                if size < 1024:
                    size_str = f"{size}B"
                elif size < 1024*1024:
                    size_str = f"{size/1024:.1f}KB"
                else:
                    size_str = f"{size/1024/1024:.1f}MB"
                results.append(f"{name} ({size_str})")
            
            return "找到以下文件:\n" + "\n".join(results)
        except Exception as e:
            return f"搜索失败: {e}"
    
    # ========== 打开应用 ==========
    def _do_open_app(self, args):
        app = args.get("app", "")
        
        apps = {
            "浏览器": "msedge",
            "browser": "msedge",
            "edge": "msedge",
            "chrome": "chrome",
            "firefox": "firefox",
            "记事本": "notepad",
            "notepad": "notepad",
            "计算器": "calc",
            "calc": "calc",
            "文件管理器": "explorer",
            "explorer": "explorer",
            "设置": "ms-settings:",
            "terminal": "cmd",
            "cmd": "cmd",
            "powershell": "powershell",
        }
        
        cmd = apps.get(app, app)
        
        try:
            subprocess.Popen(
                f'start "" {cmd}',
                shell=True,
                creationflags=0x08000000
            )
            return f"已打开: {app}"
        except Exception as e:
            return f"打开失败: {e}"
    
    # ========== 读取文件 ==========
    def _do_read_file(self, args):
        path = args.get("path", "")
        if not path:
            return "文件路径不能为空"
        
        if not os.path.isabs(path):
            path = os.path.join(os.path.expanduser("~"), path)
        
        if not os.path.exists(path):
            return f"文件不存在: {path}"
        
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            if len(content) > 500:
                return content[:500] + "\n\n... (内容过长)"
            return content or "文件为空"
        except Exception as e:
            return f"读取失败: {e}"
    
    # ========== 列出目录 ==========
    def _do_list_dir(self, args):
        path = args.get("path", ".")
        
        if path == ".":
            path = self.script_dir
        elif not os.path.isabs(path):
            path = os.path.join(os.path.expanduser("~"), path)
        
        if not os.path.exists(path):
            return f"目录不存在: {path}"
        
        try:
            items = os.listdir(path)
            files = [f for f in items if os.path.isfile(os.path.join(path, f))]
            dirs = [d for d in items if os.path.isdir(os.path.join(path, d))]
            
            result = f"目录: {path}\n\n"
            if dirs:
                result += "📁 文件夹:\n" + "\n".join(f"  {d}/" for d in dirs[:10]) + "\n"
            if files:
                result += "📄 文件:\n" + "\n".join(f"  {f}" for f in files[:10])
            
            return result or "目录为空"
        except Exception as e:
            return f"读取失败: {e}"
    
    # ========== 执行命令 ==========
    def _do_exec(self, args):
        command = args.get("command", "")
        if not command:
            return "命令不能为空"
        
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                timeout=10,
                creationflags=0x08000000,
            )
            output = result.stdout.decode('utf-8', errors='ignore')
            if len(output) > 500:
                output = output[:500] + "\n\n... (输出过长)"
            return output or "命令执行完成"
        except Exception as e:
            return f"执行失败: {e}"
    
    # ========== 检查提醒 ==========
    def check_reminders(self):
        """检查提醒并触发"""
        file_path = os.path.join(self.script_dir, "reminders.json")
        if not os.path.exists(file_path):
            return 0
        
        with open(file_path, 'r', encoding='utf-8') as f:
            reminders = json.load(f)
        
        now = datetime.now()
        fired = []
        
        for r in reminders:
            if r.get("done"):
                continue
            try:
                trigger = datetime.strptime(r["trigger_time"], "%Y-%m-%d %H:%M:%S")
                if trigger <= now:
                    fired.append(r)
                    r["done"] = True
            except:
                pass
        
        if fired:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(reminders, f, ensure_ascii=False, indent=2)
            
            for r in fired:
                if self.pet_window:
                    msg = f"提醒: {r['text']}"
                    from pet import BubbleWidget
                    self.pet_window.bubble.show_text(msg, 8000, BubbleWidget.PRIORITY_REMINDER)
                    if hasattr(self.pet_window, 'engine') and hasattr(self.pet_window.engine, 'tts'):
                        self.pet_window.engine.tts.speak(msg)
        
        return len(fired)
