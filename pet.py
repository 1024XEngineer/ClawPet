import sys
import os
import json
import time
import random
import asyncio
import edge_tts
import tempfile
import threading
import ctypes
import psutil
import traceback
from openai import OpenAI
from PyQt5.QtWidgets import QApplication, QLabel, QPushButton, QLineEdit, QWidget, QMenu, QAction
from PyQt5.QtGui import QMovie, QFont, QColor, QFontMetrics, QPainter, QPainterPath, QPolygonF
from PyQt5.QtCore import Qt, QTimer, QSize, QPointF, QRectF, pyqtSignal, QObject

# Import enhanced modules
from tts_manager import TTSManager
from pet_system import PetAttributes, PetMemory, PetBehavior, JsonStorage, MarkdownStorage, DatabaseStorage
from character_system import get_current_character, set_current_character
from character_editor import SettingsDialog, get_settings

# ==========================================
# Configuration & Logging
# ==========================================
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pet.log')
VOICE = "zh-CN-XiaoxiaoNeural"

# 智谱 AI (BigModel) - GLM-4-Flash 永久免费
SYSTEM_PROMPT = "你是一个可爱的桌面宠物助手，说话简短有趣，每次回复不超过50字。"

GREETINGS = [
    "你好呀！今天想聊点什么？",
    "嗨~ 我在这里陪你哦！",
    "主人好！有什么吩咐吗？",
    "今天天气不错呢，想聊什么？",
]

HOT_WARNINGS = [
    "好热呀...电脑快变成烤箱了！",
    "CPU好烫，我都要冒烟了...",
    "主人，电脑温度太高啦，让它休息一下吧~",
]

def log(msg):
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")

# Global exception handler
def handle_exception(exc_type, exc_value, exc_traceback):
    log(f"CRASH: {exc_type.__name__}: {exc_value}")
    log("".join(traceback.format_exception(exc_type, exc_value, exc_traceback)))
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return

sys.excepthook = handle_exception

# ==========================================
# Managers (Extensible Architecture)
# ==========================================
class Config:
    def __init__(self):
        self.x = None
        self.y = None
        self.load()

    def load(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.x = data.get('x')
                    self.y = data.get('y')
            except:
                pass

    def save(self, x, y):
        self.x = x
        self.y = y
        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump({'x': x, 'y': y}, f, ensure_ascii=False)
        except:
            pass

class AIManager(QObject):
    reply_signal = pyqtSignal(str, bool)  # (reply, is_error)

    def __init__(self, memory=None):
        super().__init__()
        
        # AI 后端配置
        self.ai_backend = "zhipu"  # "zhipu" 或 "picoclaw"
        self.picoclaw_url = "http://localhost:18790"
        
        # 智谱 AI (BigModel) - GLM-4-Flash 免费模型
        self.client = OpenAI(
            api_key="5d39d0bfe2c2460e9e6582b7491adb98.gxG35KpkMEaGFW6s",
            base_url="https://open.bigmodel.cn/api/paas/v4/",
        )
        self.chat_history = []
        self.is_thinking = False
        self.character = get_current_character()
        self.memory = memory

    def refresh_character(self):
        """重新加载角色配置"""
        self.character = get_current_character()
        self.chat_history.clear()
        log(f"切换角色: {self.character.name}")

    def get_system_prompt(self):
        """获取当前角色的系统提示"""
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
            # 获取记忆上下文
            memory_context = self.memory.get_memory_context() if self.memory else ""
            
            # 构建系统提示（含记忆）
            system_prompt = self.get_system_prompt()
            if memory_context:
                system_prompt += f"\n\n【主人相关记忆】\n{memory_context}"
            
            if self.ai_backend == "picoclaw":
                reply = self._ask_picoclaw(text, system_prompt)
            else:
                reply = self._ask_zhipu(text, system_prompt)
            
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
    
    def _ask_zhipu(self, text, system_prompt):
        """调用智谱 AI"""
        messages = [
            {"role": "system", "content": system_prompt},
        ]
        messages.extend(self.chat_history[-6:])
        messages.append({"role": "user", "content": text})

        response = self.client.chat.completions.create(
            model="glm-4-flash",
            messages=messages,
            max_tokens=150,
            temperature=0.8,
        )
        
        if response.choices and len(response.choices) > 0:
            content = response.choices[0].message.content
            if content:
                return content.strip()
        return None
    
    def _ask_picoclaw(self, text, system_prompt):
        """调用 PicoClaw Gateway"""
        import requests
        
        # 构造 PicoClaw 格式的消息
        messages = [
            {"role": "system", "content": system_prompt},
        ]
        messages.extend(self.chat_history[-6:])
        messages.append({"role": "user", "content": text})
        
        try:
            response = requests.post(
                f"{self.picoclaw_url}/v1/chat/completions",
                json={
                    "model": "auto",
                    "messages": messages,
                    "max_tokens": 150,
                    "temperature": 0.8,
                },
                timeout=30,
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("choices"):
                    return data["choices"][0]["message"]["content"].strip()
            else:
                log(f"PicoClaw error: {response.status_code} - {response.text[:100]}")
                
        except requests.exceptions.ConnectionError:
            log("PicoClaw Gateway 未连接，尝试本地 AI...")
            # 回退到智谱 AI
            return self._ask_zhipu(text, system_prompt)
        except Exception as e:
            log(f"PicoClaw 请求失败: {e}")
            
        return None

class MonitorManager:
    def __init__(self):
        self.cpu_usage = 0
        self.is_hot = False
        self.hot_msg = ""
        self._timer = None
        self._callback = None

    def start(self, callback, interval=1000):
        self._callback = callback
        psutil.cpu_percent()
        self._timer = QTimer()
        self._timer.timeout.connect(self._update)
        self._timer.start(interval)

    def _update(self):
        self.cpu_usage = psutil.cpu_percent()
        if self.cpu_usage > 80:
            if not self.is_hot:
                self.is_hot = True
                import random
                self.hot_msg = random.choice(HOT_WARNINGS)
        else:
            self.is_hot = False
            self.hot_msg = ""
        
        if self._callback:
            self._callback(self.cpu_usage, self.is_hot, self.hot_msg)

# ==========================================
# UI Components
# ==========================================
class BubbleWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self._text = ""
        self._timer = None
        self._max_w = 260
        self._padding = 12
        self._font_size = 10
        self.hide()

    def show_text(self, text, duration=5000):
        self._text = text
        self._calc_size()
        self.show()

        if self._timer:
            self._timer.stop()
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self.hide)
        self._timer.start(duration)

    def _calc_size(self):
        font = QFont("Microsoft YaHei", self._font_size)
        fm = QFontMetrics(font)
        content_w = self._max_w - self._padding * 2
        
        lines = []
        current_line = ""
        for char in self._text:
            test_line = current_line + char
            if fm.horizontalAdvance(test_line) <= content_w:
                current_line = test_line
            else:
                if current_line:
                    lines.append(current_line)
                current_line = char
        
        if current_line:
            lines.append(current_line)
        
        line_h = fm.height() + 4
        text_h = line_h * len(lines) + self._padding * 2
        
        max_h = 250
        self.setFixedSize(self._max_w, min(text_h, max_h))

        x = (280 - self._max_w) // 2
        self.move(x, 35)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        w, h = self.width(), self.height()
        p = self._padding
        r = 16
        tail_h = 12
        body_h = h - tail_h

        path = QPainterPath()
        path.addRoundedRect(QRectF(p, 0, w - 2*p, body_h), r, r)

        cx = w / 2
        tail = QPolygonF([
            QPointF(cx - 8, body_h),
            QPointF(cx, h),
            QPointF(cx + 8, body_h),
        ])
        path.addPolygon(tail)

        painter.fillPath(path, QColor(255, 255, 255, 235))

        painter.setPen(QColor(51, 51, 51))
        font = QFont("Microsoft YaHei", self._font_size)
        painter.setFont(font)

        line_h = painter.fontMetrics().height() + 4
        content_w = self._max_w - self._padding * 2
        
        lines = []
        current_line = ""
        for char in self._text:
            test_line = current_line + char
            if painter.fontMetrics().horizontalAdvance(test_line) <= content_w:
                current_line = test_line
            else:
                lines.append(current_line)
                current_line = char
        if current_line:
            lines.append(current_line)
        
        fm = painter.fontMetrics()
        total_text_h = line_h * len(lines)
        available_h = body_h - self._padding * 2
        top_padding = (available_h - total_text_h) / 2
        
        for i, line in enumerate(lines):
            line_w = fm.horizontalAdvance(line)
            x = (w - line_w) // 2
            y = self._padding + int(top_padding) + (i + 1) * line_h - fm.descent()
            painter.drawText(int(x), int(y), line)

class StatusDot(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(12, 12)
        self._color = QColor(76, 175, 80)

    def set_color(self, r, g, b):
        self._color = QColor(r, g, b)
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setBrush(self._color)
        painter.setPen(Qt.NoPen)
        painter.drawEllipse(0, 0, 12, 12)

# ==========================================
# Main Window
# ==========================================
class PetWindow(QWidget):
    def __init__(self, engine):
        super().__init__()
        log("Initializing PetWindow...")
        self.engine = engine
        self._dragging = False
        self._press_pos = None
        self._reply_timeout = QTimer(self)
        self._reply_timeout.setSingleShot(True)
        self._reply_timeout.timeout.connect(self._on_reply_timeout)

        # Stable window flags for desktop pet
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WA_DeleteOnClose, False)
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._show_context_menu)

        # Load settings
        self.settings = get_settings()
        pet_size = self.settings.get("pet_size", 150)
        
        # 计算窗口高度: pet_y + pet_size + input_area + margin
        # pet_y = pet_size + 80
        # input_y = pet_y + pet_size + 20 = pet_size + 80 + pet_size + 20 = pet_size * 2 + 100
        window_height = pet_size * 2 + 150
        self.resize(280, window_height)

        # Position
        sw = QApplication.primaryScreen().geometry().width()
        sh = QApplication.primaryScreen().geometry().height()
        if engine.config.x is not None:
            self.move(engine.config.x, engine.config.y)
        else:
            self.move(sw // 2 - 140, sh - window_height - 100)

        log(f"Window position set to: {self.x()}, {self.y()}")

        # UI Elements
        self._setup_ui()
        
        # Apply settings
        self._apply_settings()
        
        # Connect signals
        self.text_input.returnPressed.connect(self._on_send)
        self.send_btn.clicked.connect(self._on_send)
        self.engine.ai.reply_signal.connect(self._handle_reply)

        # Start managers
        psutil.cpu_percent()  # First call returns 0, initialize first
        engine.monitor.start(self._on_cpu_update)
        
        # Connect behavior engine callbacks
        engine.behavior.set_callback('on_speak', self._on_proactive_speak)
        engine.behavior.set_callback('on_action', self._on_random_action)
        engine.behavior.start()
        
        # Greeting based on time since last interaction
        hours_idle = engine.memory.get_time_since_last_interaction()
        if hours_idle > 24:
            greeting = "主人好久不见！我都想你了~"
        elif hours_idle > 2:
            greeting = "你终于回来啦！"
        else:
            greeting = self.engine.ai.character.get_response('greeting', GREETINGS[int(time.time()) % len(GREETINGS)])
        bubble_duration = self.settings.get("bubble_duration", 8) * 1000
        QTimer.singleShot(500, lambda: self.bubble.show_text(greeting, bubble_duration))
        
        log("PetWindow initialized successfully.")

    def _setup_ui(self):
        pet_dir = os.path.dirname(os.path.abspath(__file__))
        self._pet_size = self.settings.get("pet_size", 150)
        
        # 计算布局
        pet_x = (280 - self._pet_size) // 2
        pet_y = self._pet_size + 80  # 宠物在窗口下方
        
        # CPU label
        self.cpu_label = QLabel("CPU: --%", self)
        self.cpu_label.setGeometry(190, 4, 80, 24)
        self.cpu_label.setAlignment(Qt.AlignCenter)
        self.cpu_label.setStyleSheet("QLabel { background: transparent; color: #4CAF50; font-size: 11px; font-family: 'Microsoft YaHei'; }")

        # Speech bubble
        self.bubble = BubbleWidget(self)
        self.bubble.move(10, 30)
        self.bubble.hide()

        # Status dot
        self.status_dot = StatusDot(self)
        self.status_dot.move(12, 30)

        # Pet image
        self.pet_label = QLabel(self)
        self.pet_label.setGeometry(pet_x, pet_y, self._pet_size, self._pet_size)
        self.pet_label.setAlignment(Qt.AlignCenter)

        idle_path = os.path.join(pet_dir, 'png', 'init.png')
        speak_path = os.path.join(pet_dir, 'png', 'p1.gif')
        angry_path = os.path.join(pet_dir, 'png', 'angry.gif')
        touch_path = os.path.join(pet_dir, 'png', 'touch.gif')

        self.idle_movie = QMovie(idle_path) if os.path.exists(idle_path) else QMovie()
        self.idle_movie.setScaledSize(QSize(self._pet_size, self._pet_size))
        self.idle_movie.start()

        self.speak_movie = QMovie(speak_path) if os.path.exists(speak_path) else self.idle_movie
        self.speak_movie.setScaledSize(QSize(self._pet_size, self._pet_size))

        self.angry_movie = QMovie(angry_path) if os.path.exists(angry_path) else self.idle_movie
        self.angry_movie.setScaledSize(QSize(self._pet_size, self._pet_size))

        self.touch_movie = QMovie(touch_path) if os.path.exists(touch_path) else self.idle_movie
        self.touch_movie.setScaledSize(QSize(self._pet_size, self._pet_size))

        self.pet_label.setMovie(self.idle_movie)

        # Animation state machine to prevent conflicts
        self._anim_state = "idle"  # idle, speaking, angry, touch
        self._anim_lock = threading.Lock()

        # Touch timer
        self._touch_end_timer = QTimer(self)
        self._touch_end_timer.setSingleShot(True)
        self._touch_end_timer.timeout.connect(self._on_touch_done)

        # Random angry timer
        self._angry_timer = QTimer(self)
        self._angry_timer.setSingleShot(True)
        self._angry_timer.timeout.connect(self._play_angry)
        self._angry_end_timer = QTimer(self)
        self._angry_end_timer.setSingleShot(True)
        self._angry_end_timer.timeout.connect(self._on_angry_done)
        self._schedule_angry()

        # 布局常量
        WINDOW_W = 280
        BTN_SIZE = 36
        BTN_GAP = 6
        MARGIN = 10

        # 按钮位置 (右侧，垂直排列)
        right_edge = WINDOW_W - MARGIN
        btn_x = right_edge - BTN_SIZE
        ghost_y = pet_y + self._pet_size - BTN_SIZE
        send_y = ghost_y + BTN_SIZE + BTN_GAP

        # 输入框 (与发送按钮底部对齐)
        input_h = BTN_SIZE
        input_y = send_y
        input_w = btn_x - MARGIN

        # Ghost button
        self.ghost_btn = QPushButton("👻", self)
        self.ghost_btn.setGeometry(btn_x, ghost_y, BTN_SIZE, BTN_SIZE)
        self.ghost_btn.setStyleSheet("""
            QPushButton {
                background: rgba(150,150,150,0.3); color: white; border: none;
                border-radius: 18px; font-size: 16px;
            }
            QPushButton:hover { background: rgba(150,150,150,0.6); }
            QPushButton:pressed { background: rgba(130,130,130,0.6); }
        """)
        self.ghost_btn.clicked.connect(self._toggle_ghost)
        self.is_ghost = False

        # Send button
        self.send_btn = QPushButton("➤", self)
        self.send_btn.setGeometry(btn_x, send_y, BTN_SIZE, BTN_SIZE)
        self.send_btn.setStyleSheet("""
            QPushButton {
                background: rgba(76,175,80,0.6); color: white; border: none;
                border-radius: 18px; font-size: 16px; font-weight: bold;
            }
            QPushButton:hover { background: rgba(76,175,80,0.8); }
            QPushButton:pressed { background: rgba(61,139,64,0.8); }
            QPushButton:disabled { background: rgba(170,170,170,0.3); }
        """)

        # Input area
        self.text_input = QLineEdit(self)
        self.text_input.setGeometry(MARGIN, input_y, input_w, input_h)
        self.text_input.setPlaceholderText("和我说说话...")
        self.text_input.setMaxLength(200)
        self.text_input.setStyleSheet("""
            QLineEdit {
                padding: 8px 14px; border: 2px solid rgba(255,255,255,0.4); border-radius: 18px;
                font-size: 12px; font-family: 'Microsoft YaHei';
                background: rgba(255,255,255,0.3); color: #333;
            }
            QLineEdit:focus { border-color: rgba(76,175,80,0.6); background: rgba(255,255,255,0.5); }
            QLineEdit:disabled { background: rgba(200,200,200,0.2); color: #999; }
        """)

    def _toggle_ghost(self):
        self.is_ghost = not self.is_ghost
        if self.is_ghost:
            self.setWindowOpacity(0.15)
            self.ghost_btn.setStyleSheet("""
                QPushButton {
                    background: rgba(150,150,150,0.8); color: white; border: none;
                    border-radius: 21px; font-size: 20px;
                }
            """)
        else:
            self.setWindowOpacity(1.0)
            self.ghost_btn.setStyleSheet("""
                QPushButton {
                    background: rgba(150,150,150,0.5); color: white; border: none;
                    border-radius: 21px; font-size: 20px;
                }
                QPushButton:hover { background: rgba(150,150,150,0.8); }
                QPushButton:pressed { background: rgba(130,130,130,0.8); }
            """)
    
    def _apply_settings(self, changes=None):
        """应用设置更改"""
        if changes is None:
            changes = {}
        
        # 重新加载设置
        self.settings = get_settings()
        pet_size = self.settings.get("pet_size", 150)
        
        # 布局常量
        WINDOW_W = 280
        BTN_SIZE = 36
        BTN_GAP = 6
        MARGIN = 10
        
        # 计算新的布局
        pet_x = (WINDOW_W - pet_size) // 2
        pet_y = pet_size + 80
        right_edge = WINDOW_W - MARGIN
        btn_x = right_edge - BTN_SIZE
        ghost_y = pet_y + pet_size - BTN_SIZE
        send_y = ghost_y + BTN_SIZE + BTN_GAP
        input_y = send_y
        input_w = btn_x - MARGIN
        
        # 应用大小
        if pet_size != self._pet_size or changes.get("size"):
            self._pet_size = pet_size
            self.pet_label.setFixedSize(pet_size, pet_size)
            self.idle_movie.setScaledSize(QSize(pet_size, pet_size))
            self.speak_movie.setScaledSize(QSize(pet_size, pet_size))
            self.angry_movie.setScaledSize(QSize(pet_size, pet_size))
            self.touch_movie.setScaledSize(QSize(pet_size, pet_size))
            
            # 调整窗口大小
            window_h = pet_size * 2 + 150
            self.resize(WINDOW_W, window_h)
            
            # 重新定位所有元素
            self.pet_label.move(pet_x, pet_y)
            self.ghost_btn.move(btn_x, ghost_y)
            self.send_btn.move(btn_x, send_y)
            self.text_input.move(MARGIN, input_y)
            self.text_input.resize(input_w, BTN_SIZE)
        
        # 应用透明度
        opacity = self.settings.get("pet_opacity", 1.0)
        self.setWindowOpacity(opacity)
        
        # 应用CPU显示
        show_cpu = self.settings.get("show_cpu", True)
        self.cpu_label.setVisible(show_cpu)
        
        # 应用气泡设置
        bubble_max_width = self.settings.get("bubble_max_width", 260)
        bubble_font_size = self.settings.get("bubble_font_size", 10)
        self.bubble._max_w = bubble_max_width
        self.bubble._font_size = bubble_font_size
        self.bubble.update()
        
        # 应用显示设置
        show_status = self.settings.get("show_status", True)
        self.status_dot.setVisible(show_status)
        
        show_input = self.settings.get("show_input", True)
        self.text_input.setVisible(show_input)
        self.send_btn.setVisible(show_input)
        
        show_ghost_btn = self.settings.get("show_ghost_btn", True)
        self.ghost_btn.setVisible(show_ghost_btn)
        
        # 角色更改
        if changes.get("character_changed"):
            self.engine.ai.refresh_character()
            greeting = self.engine.ai.character.greeting
            bubble_duration = self.settings.get("bubble_duration", 8) * 1000
            self.bubble.show_text(greeting, bubble_duration)

    def _set_animation(self, state, movie=None):
        """Thread-safe animation state machine"""
        with self._anim_lock:
            # Priority: speaking > touch > angry > idle
            priority = {"idle": 0, "angry": 1, "touch": 2, "speaking": 3}
            if priority.get(state, 0) < priority.get(self._anim_state, 0):
                return  # Lower priority animation, skip
            self._anim_state = state
            if movie:
                self.pet_label.setMovie(movie)
                movie.start()

    def _reset_to_idle(self):
        """Reset to idle state"""
        with self._anim_lock:
            self._anim_state = "idle"
            self.pet_label.setMovie(self.idle_movie)
            self.idle_movie.start()

    def _schedule_angry(self):
        import random
        delay = random.randint(30000, 120000)
        log(f"Scheduling angry animation in {delay//1000}s")
        self._angry_timer.start(delay)

    def _play_angry(self):
        if self.engine.ai.is_thinking:
            log("Angry skipped: AI is thinking")
            self._schedule_angry()
            return
        self._set_animation("angry", self.angry_movie)
        log("Playing angry animation")
        self._angry_end_timer.start(5000)

    def _on_angry_done(self):
        log("Angry animation ended, rescheduling")
        self._angry_end_timer.stop()
        if self._anim_state == "angry":
            self._reset_to_idle()
        self._schedule_angry()

    def _play_touch(self):
        if not self.settings.get("touch_enabled", True):
            return
            
        log("Touch animation triggered")
        self._touch_end_timer.stop()
        self._angry_timer.stop()
        
        # 根据角色性格获取响应
        char_response = self.engine.ai.character.get_touch_response()
        bubble_duration = self.settings.get("bubble_duration", 8) * 1000
        self.bubble.show_text(char_response, bubble_duration)
        
        # 设置动画
        self.touch_movie.jumpToFrame(0)
        self._set_animation("touch", self.touch_movie)
        
        # 估算语音时长
        speech_duration = max(1500, len(char_response) * 300)
        self._touch_end_timer.start(speech_duration)
        
        # 检查是否启用语音
        if self.settings.get("speech_enabled", True):
            self.engine.tts.speak(char_response)

    def _on_touch_done(self):
        log("Touch animation ended")
        if self._anim_state == "touch":
            self._reset_to_idle()
        self._schedule_angry()

    def _on_cpu_update(self, usage, is_hot, hot_msg):
        self.cpu_label.setText(f"CPU: {usage}%")
        was_hot = getattr(self, '_was_cpu_hot', False)
        
        if is_hot:
            self.cpu_label.setStyleSheet("QLabel { background: transparent; color: #f44336; font-size: 11px; font-family: 'Microsoft YaHei'; }")
            if not was_hot:
                self.bubble.show_text(hot_msg, 6000)
                self._set_animation("angry", self.speak_movie)
        else:
            self.cpu_label.setStyleSheet("QLabel { background: transparent; color: #4CAF50; font-size: 11px; font-family: 'Microsoft YaHei'; }")
            if was_hot:
                self._reset_to_idle()
        
        self._was_cpu_hot = is_hot

    def _on_send(self):
        text = self.text_input.text().strip()
        if not text:
            return
        self.text_input.clear()
        self.text_input.setEnabled(False)
        self.send_btn.setEnabled(False)
        self.bubble.show_text("思考中...", 3000)
        
        # Update pet behavior on user interaction
        self.engine.behavior.on_user_interaction(text)
        
        # Record interaction in memory
        self.engine.memory.add_interaction(text, "")
        
        self._reply_timeout.start(30000)
        self.engine.ai.ask(text)

    def _handle_reply(self, reply, is_error=False):
        self._reply_timeout.stop()
        try:
            self.text_input.setEnabled(True)
            self.send_btn.setEnabled(True)
            
            # Update memory with pet's reply
            if self.engine.memory.short_term:
                self.engine.memory.short_term[-1]['pet'] = reply
                self.engine.memory.save()

            # --- 严格过滤：只播放纯净的聊天回复 ---
            import re
            
            # 1. 检查显式错误标志
            if is_error:
                log(f"API Error (blocked): {reply}")
                self.bubble.show_text("网络似乎有点问题...", 3000)
                return

            # 2. 简化过滤：只接受纯自然语言文本
            lower_reply = reply.lower()
            
            # 2.1 允许中文日期时间，但屏蔽技术数字
            # 允许: 5月7号, 3点, 上午, 今天, 2024年
            # 屏蔽: IP地址, 版本号, 错误码, 百分比
            if re.search(r'\d', reply):
                # 技术数字模式: IP地址, 百分比, 版本号, 错误码
                tech_number_patterns = [
                    r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}',  # IP地址
                    r'\d+%',  # 百分比
                    r'v\d+\.\d+',  # 版本号
                    r'error.*\d+',  # 错误码
                    r'status.*\d+',  # 状态码
                    r'http.*\d{3}',  # HTTP状态码
                ]
                if any(re.search(p, lower_reply) for p in tech_number_patterns):
                    log(f"[BLOCKED] 技术数字: {reply[:50]}")
                    self.bubble.show_text("网络似乎有点问题...", 3000)
                    return
                # 如果是普通日期/时间数字，允许通过
                # 例如: 5月7号, 3点, 2024年, 上午10点
            
            # 2.2 屏蔽技术符号
            tech_chars = ['{', '}', '[', ']', ':', '=', '<', '>', '/', '\\', '|', '@', '#', '$', '%', '^', '&', '*', '(', ')', '+', '"', "'"]
            if any(c in reply for c in tech_chars):
                log(f"[BLOCKED] 技术符号: {reply[:50]}")
                self.bubble.show_text("网络似乎有点问题...", 3000)
                return
            
            # 2.3 屏蔽技术关键词
            tech_keywords = [
                'error', 'exception', 'traceback', 'forbidden', 'unauthorized',
                'invalid', 'quota', 'balance', 'sorry', 'account', 'message',
                'rate limit', 'timeout', 'latency', 'delay', 'status', 'code',
                'http', 'response', 'request', 'api', 'key', 'url', 'json'
            ]
            if any(kw in lower_reply for kw in tech_keywords):
                log(f"[BLOCKED] 技术关键词: {reply[:50]}")
                self.bubble.show_text("网络似乎有点问题...", 3000)
                return
            
            # 2.4 检查空回复
            if not reply.strip():
                return

            # --- 正常回复：显示并播放 ---
            # 分析回复内容，确定情绪和动画
            emotion_data = self.engine.ai.character.analyze_user_input(reply)
            emotion = emotion_data["emotion"]
            animation = emotion_data["animation"]
            
            log(f"Character response - emotion: {emotion}, animation: {animation}")
            
            bubble_duration = self.settings.get("bubble_duration", 8) * 1000
            self.bubble.show_text(reply, bubble_duration)
            
            # 根据情绪选择动画
            animation_map = {
                "happy": self.touch_movie,
                "angry": self.angry_movie,
                "sleepy": self.idle_movie,
            }
            current_movie = animation_map.get(animation, self.speak_movie)
            
            self.status_dot.set_color(255, 152, 0)
            
            # 先停止当前动画，重新开始
            current_movie.jumpToFrame(0)
            self._set_animation("speaking", current_movie)
            
            # 估算语音时长（每字符约0.3秒）
            speech_duration = max(2000, len(reply) * 300)
            
            # 设置动画恢复计时器
            QTimer.singleShot(speech_duration, self._reset_to_idle)
            QTimer.singleShot(speech_duration, lambda: self.status_dot.set_color(76, 175, 80))
            
            # 检查是否启用语音
            if self.settings.get("speech_enabled", True):
                self.engine.tts.speak(reply)
            
        except Exception as e:
            log(f"UI Update Error: {e}")

    def _on_reply_timeout(self):
        self.bubble.show_text("回复超时，请重试", 5000)
        self.text_input.setEnabled(True)
        self.send_btn.setEnabled(True)
        self.engine.ai.is_thinking = False

    def _on_proactive_speak(self, msg, proactive=False):
        """Handle proactive speech from behavior engine"""
        if not self.settings.get("proactive_enabled", True):
            return
            
        from character_system import EmotionDetector
        
        emotion = EmotionDetector.detect(msg)
        char_response = self.engine.ai.character.get_response(emotion, msg)
        
        animation_map = {
            "happy": self.touch_movie,
            "angry": self.angry_movie,
            "sleepy": self.idle_movie,
        }
        animation = EmotionDetector.get_animation_for_emotion(emotion)
        current_movie = animation_map.get(animation, self.speak_movie)
        
        bubble_duration = self.settings.get("bubble_duration", 8) * 1000
        self.bubble.show_text(char_response, bubble_duration)
        
        current_movie.jumpToFrame(0)
        self._set_animation("speaking", current_movie)
        
        speech_duration = max(2000, len(char_response) * 300)
        QTimer.singleShot(speech_duration, self._reset_to_idle)
        
        if self.settings.get("speech_enabled", True):
            self.engine.tts.speak(char_response)
    
    def _show_char_response(self, emotion, duration=3000):
        """显示角色性格化的回复"""
        default_msgs = {
            "sleepy": ["哈欠...好困啊", "Zzz...", "困困的..."],
            "happy": ["开心~", "嘿嘿~", "好开心！"],
            "hungry": ["肚子好饿...", "想吃好吃的...", "饿饿~"],
            "sad": ["难过...", "呜呜...", "抱抱..."],
        }
        msg = self.engine.ai.character.get_response(emotion, random.choice(default_msgs.get(emotion, ["..."])))
        self.bubble.show_text(msg, duration)

    def _on_random_action(self, action):
        """Handle random action from behavior engine"""
        action_emotions = {
            "dance": "happy",
            "yawn": "sleepy",
            "sleep": "sleepy",
            "stretch": "happy",
            "sigh": "sad",
            "rub_belly": "hungry",
        }
        emotion = action_emotions.get(action, "normal")
        
        action_map = {
            "dance": lambda: (self.touch_movie.jumpToFrame(0), self._set_animation("happy", self.touch_movie), self._show_char_response("happy")),
            "yawn": lambda: (self.idle_movie.jumpToFrame(0), self._set_animation("idle", self.idle_movie), self._show_char_response("sleepy")),
            "sleep": lambda: (self.idle_movie.jumpToFrame(0), self._set_animation("idle", self.idle_movie), self.bubble.show_text("Zzz...", 5000)),
            "stretch": lambda: (self.touch_movie.jumpToFrame(0), self._set_animation("happy", self.touch_movie), self._show_char_response("happy")),
            "sigh": lambda: (self.idle_movie.jumpToFrame(0), self._set_animation("idle", self.idle_movie), self._show_char_response("sad")),
            "rub_belly": lambda: (self.angry_movie.jumpToFrame(0), self._set_animation("angry", self.angry_movie), self._show_char_response("hungry")),
            "look_around": lambda: None,
            "wiggle": lambda: None,
            "blink": lambda: None,
        }
        if action in action_map:
            action_map[action]()
            if action in ["dance", "stretch", "yawn", "sigh"]:
                QTimer.singleShot(3000, self._reset_to_idle)

    def _show_context_menu(self, pos):
        menu = QMenu(self)
        
        # 角色信息
        char_name = self.engine.ai.character.name
        char_action = QAction(f"🎭 {char_name}", self)
        char_action.setEnabled(False)
        menu.addAction(char_action)
        
        menu.addSeparator()
        
        # 设置
        settings_action = QAction("⚙️ 设置", self)
        settings_action.triggered.connect(self._on_open_settings)
        menu.addAction(settings_action)
        
        menu.addSeparator()
        
        close_action = QAction("❌ 关闭桌宠", self)
        close_action.triggered.connect(self._on_close)
        menu.addAction(close_action)
        menu.exec_(self.mapToGlobal(pos))
    
    def _on_open_settings(self):
        dialog = SettingsDialog(self)
        dialog.settings_changed.connect(self._on_settings_changed)
        dialog.exec_()
    
    def _on_settings_changed(self, changes):
        self._apply_settings(changes)
    
    def _on_switch_character(self):
        from character_editor import CharacterQuickSelect
        dialog = CharacterQuickSelect(self)
        dialog.character_selected.connect(self._on_character_switched)
        dialog.exec_()
    
    def _on_character_switched(self, filepath):
        self.engine.ai.refresh_character()
        greeting = self.engine.ai.character.greeting
        bubble_duration = self.settings.get("bubble_duration", 8) * 1000
        self.bubble.show_text(greeting, bubble_duration)

    def _on_close(self):
        log("Closing pet...")
        try:
            self.engine.config.save(self.x(), self.y())
        except:
            pass
        QApplication.instance().quit()

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self._press_pos = event.globalPos()
            self._dragging = True
            self._drag_pos = event.globalPos() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if self._dragging and event.buttons() == Qt.LeftButton:
            self.move(event.globalPos() - self._drag_pos)
            event.accept()

    def mouseReleaseEvent(self, event):
        if self._dragging and self._press_pos:
            # Only trigger touch if barely moved (less than 3 pixels)
            dist = (event.globalPos() - self._press_pos).manhattanLength()
            if dist < 3:
                # Check if the press was on the pet image
                local_pos = self.mapFromGlobal(self._press_pos)
                if self.pet_label.geometry().contains(local_pos):
                    self._play_touch()
        self._dragging = False
        self._press_pos = None

    def closeEvent(self, event):
        self._on_close()
        event.accept()

    def showEvent(self, event):
        super().showEvent(event)
        self.raise_()
        self.activateWindow()

# ==========================================
# Engine & Entry Point
# ==========================================
class PetEngine:
    def __init__(self):
        self.config = Config()
        
        # Pet System (attributes, memory, behavior) - memory需要先创建
        self.attributes = PetAttributes()
        self.memory = PetMemory()
        self.behavior = PetBehavior(self.attributes, self.memory)
        
        # AI 需要 memory 引用
        self.ai = AIManager(self.memory)
        self.tts = TTSManager()
        self.monitor = MonitorManager()

def main():
    log("Starting Pet Application...")
    try:
        app = QApplication(sys.argv)
        app.setQuitOnLastWindowClosed(False)
        
        engine = PetEngine()
        
        # Start pet behavior engine (proactive speaking, random actions)
        engine.behavior.set_callback('on_speak', lambda msg, proactive=False: None)
        engine.behavior.set_callback('on_action', lambda action: None)
        engine.behavior.start()
        
        window = PetWindow(engine)
        window.show()
        
        log("Application loop started.")
        sys.exit(app.exec_())
    except Exception as e:
        log(f"Fatal error: {e}\n{traceback.format_exc()}")

if __name__ == '__main__':
    main()
