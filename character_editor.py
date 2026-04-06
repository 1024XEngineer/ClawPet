"""
设置界面 - 桌宠个性化配置
"""
import os
from PyQt5.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel, 
                             QLineEdit, QTextEdit, QPushButton, QListWidget,
                             QCheckBox, QGroupBox, QScrollArea, QWidget, QMessageBox,
                             QTabWidget, QComboBox, QSpinBox, QSlider, QFileDialog,
                             QColorDialog, QFontDialog)
from PyQt5.QtCore import Qt, pyqtSignal, QSettings
from PyQt5.QtGui import QFont, QColor
from character_system import (CharacterPersona, CharacterEditor, PERSONALITY_TAGS,
                              get_current_character, set_current_character, PRESET_CHARACTERS,
                              delete_character, export_character, import_character)

SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'settings.json')

class PetSettings:
    """桌宠设置管理器"""
    
    _instance = None
    _initialized = False
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if not PetSettings._initialized:
            self.settings = self._load_settings()
            PetSettings._initialized = True
    
    def _load_settings(self):
        default_settings = {
            "pet_size": 150,
            "pet_opacity": 1.0,
            "bubble_opacity": 0.9,
            "speech_enabled": True,
            "proactive_enabled": True,
            "proactive_interval": 120,
            "touch_enabled": True,
            "auto_start": True,
            "voice_speed": 0,
            "voice_pitch": 0,
            "bubble_max_width": 260,
            "bubble_font_size": 10,
            "bubble_duration": 8,
            "show_cpu": True,
            "theme_color": "#4CAF50"
        }
        
        if os.path.exists(SETTINGS_FILE):
            try:
                import json
                with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                    saved = json.load(f)
                    default_settings.update(saved)
            except:
                pass
        
        return default_settings
    
    def reload(self):
        """重新加载设置"""
        self.settings = self._load_settings()
    
    def save(self):
        import json
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.settings, f, ensure_ascii=False, indent=2)
    
    def get(self, key, default=None):
        return self.settings.get(key, default)
    
    def set(self, key, value):
        self.settings[key] = value
    
    def get_all(self):
        return self.settings.copy()


_settings_instance = None

def get_settings():
    global _settings_instance
    if _settings_instance is None:
        _settings_instance = PetSettings()
    return _settings_instance


class SettingsDialog(QDialog):
    """设置对话框"""
    
    settings_changed = pyqtSignal(dict)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("桌宠设置")
        self.setMinimumSize(650, 500)
        self.settings = get_settings()
        self._init_ui()
    
    def _init_ui(self):
        layout = QVBoxLayout(self)
        
        title = QLabel("⚙️ 桌宠设置")
        title.setFont(QFont("Microsoft YaHei", 14, QFont.Bold))
        title.setAlignment(Qt.AlignCenter)
        layout.addWidget(title)
        
        tabs = QTabWidget()
        
        tabs.addTab(self._create_appearance_tab(), "🎨 外观")
        tabs.addTab(self._create_character_tab(), "🎭 角色")
        tabs.addTab(self._create_behavior_tab(), "🎮 行为")
        tabs.addTab(self._create_voice_tab(), "🔊 语音")
        
        layout.addWidget(tabs)
        
        btn_layout = QHBoxLayout()
        
        reset_btn = QPushButton("恢复默认")
        reset_btn.clicked.connect(self._reset_settings)
        btn_layout.addWidget(reset_btn)
        
        save_btn = QPushButton("保存")
        save_btn.setStyleSheet("""
            QPushButton {
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 10px 30px;
                font-weight: bold;
            }
            QPushButton:hover { background: #45a049; }
        """)
        save_btn.clicked.connect(self._save_settings)
        btn_layout.addWidget(save_btn)
        
        close_btn = QPushButton("关闭")
        close_btn.clicked.connect(self.close)
        btn_layout.addWidget(close_btn)
        
        layout.addLayout(btn_layout)
    
    def _create_appearance_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content = QWidget()
        content_layout = QVBoxLayout(content)
        
        # 大小设置
        size_group = QGroupBox("📏 大小设置")
        size_layout = QVBoxLayout()
        
        size_row = QHBoxLayout()
        size_row.addWidget(QLabel("桌宠大小:"))
        self.size_slider = QSlider(Qt.Horizontal)
        self.size_slider.setMinimum(80)
        self.size_slider.setMaximum(300)
        self.size_slider.setValue(self.settings.get("pet_size", 150))
        self.size_slider.setTickPosition(QSlider.TicksBelow)
        self.size_slider.setTickInterval(20)
        self.size_slider.valueChanged.connect(self._on_size_changed)
        size_row.addWidget(self.size_slider)
        
        self.size_label = QLabel(f"{self.settings.get('pet_size', 150)}px")
        size_row.addWidget(self.size_label)
        size_layout.addLayout(size_row)
        
        size_hint = QLabel("提示：拖动滑块调整桌宠大小，默认150px")
        size_hint.setStyleSheet("color: gray; font-size: 11px;")
        size_layout.addWidget(size_hint)
        
        size_group.setLayout(size_layout)
        content_layout.addWidget(size_group)
        
        # 透明度设置
        opacity_group = QGroupBox("💫 透明度设置")
        opacity_layout = QVBoxLayout()
        
        opacity_row = QHBoxLayout()
        opacity_row.addWidget(QLabel("桌宠透明度:"))
        self.opacity_slider = QSlider(Qt.Horizontal)
        self.opacity_slider.setMinimum(30)
        self.opacity_slider.setMaximum(100)
        self.opacity_slider.setValue(int(self.settings.get("pet_opacity", 1.0) * 100))
        self.opacity_slider.setTickPosition(QSlider.TicksBelow)
        self.opacity_slider.setTickInterval(10)
        self.opacity_slider.valueChanged.connect(self._on_opacity_changed)
        opacity_row.addWidget(self.opacity_slider)
        
        self.opacity_label = QLabel(f"{int(self.settings.get('pet_opacity', 1.0) * 100)}%")
        opacity_row.addWidget(self.opacity_label)
        opacity_layout.addLayout(opacity_row)
        
        bubble_opacity_row = QHBoxLayout()
        bubble_opacity_row.addWidget(QLabel("气泡透明度:"))
        self.bubble_opacity_slider = QSlider(Qt.Horizontal)
        self.bubble_opacity_slider.setMinimum(50)
        self.bubble_opacity_slider.setMaximum(100)
        self.bubble_opacity_slider.setValue(int(self.settings.get("bubble_opacity", 0.9) * 100))
        self.bubble_opacity_slider.valueChanged.connect(self._on_bubble_opacity_changed)
        bubble_opacity_row.addWidget(self.bubble_opacity_slider)
        
        self.bubble_opacity_label = QLabel(f"{int(self.settings.get('bubble_opacity', 0.9) * 100)}%")
        bubble_opacity_row.addWidget(self.bubble_opacity_label)
        opacity_layout.addLayout(bubble_opacity_row)
        
        opacity_group.setLayout(opacity_layout)
        content_layout.addWidget(opacity_group)
        
        # 气泡设置
        bubble_group = QGroupBox("💬 气泡设置")
        bubble_layout = QVBoxLayout()
        
        bubble_width_row = QHBoxLayout()
        bubble_width_row.addWidget(QLabel("气泡最大宽度:"))
        self.bubble_width_spin = QSpinBox()
        self.bubble_width_spin.setMinimum(150)
        self.bubble_width_spin.setMaximum(500)
        self.bubble_width_spin.setValue(self.settings.get("bubble_max_width", 260))
        bubble_width_row.addWidget(self.bubble_width_spin)
        bubble_width_unit = QLabel("px")
        bubble_width_row.addWidget(bubble_width_unit)
        bubble_width_row.addStretch()
        bubble_layout.addLayout(bubble_width_row)
        
        bubble_font_row = QHBoxLayout()
        bubble_font_row.addWidget(QLabel("气泡字体大小:"))
        self.bubble_font_spin = QSpinBox()
        self.bubble_font_spin.setMinimum(8)
        self.bubble_font_spin.setMaximum(20)
        self.bubble_font_spin.setValue(self.settings.get("bubble_font_size", 10))
        bubble_font_row.addWidget(self.bubble_font_spin)
        bubble_font_unit = QLabel("pt")
        bubble_font_row.addWidget(bubble_font_unit)
        bubble_font_row.addStretch()
        bubble_layout.addLayout(bubble_font_row)
        
        bubble_time_row = QHBoxLayout()
        bubble_time_row.addWidget(QLabel("气泡显示时长:"))
        self.bubble_duration_spin = QSpinBox()
        self.bubble_duration_spin.setMinimum(2)
        self.bubble_duration_spin.setMaximum(30)
        self.bubble_duration_spin.setValue(self.settings.get("bubble_duration", 8))
        bubble_time_row.addWidget(self.bubble_duration_spin)
        bubble_time_unit = QLabel("秒")
        bubble_time_row.addWidget(bubble_time_unit)
        bubble_time_row.addStretch()
        bubble_layout.addLayout(bubble_time_row)
        
        bubble_group.setLayout(bubble_layout)
        content_layout.addWidget(bubble_group)
        
        # 显示设置
        display_group = QGroupBox("👁️ 显示设置")
        display_layout = QVBoxLayout()
        
        self.show_cpu_check = QCheckBox("显示CPU使用率")
        self.show_cpu_check.setChecked(self.settings.get("show_cpu", True))
        display_layout.addWidget(self.show_cpu_check)
        
        self.show_status_check = QCheckBox("显示状态指示点")
        self.show_status_check.setChecked(self.settings.get("show_status", True))
        display_layout.addWidget(self.show_status_check)
        
        self.show_input_check = QCheckBox("显示输入框")
        self.show_input_check.setChecked(self.settings.get("show_input", True))
        display_layout.addWidget(self.show_input_check)
        
        self.show_ghost_btn_check = QCheckBox("显示幽灵按钮")
        self.show_ghost_btn_check.setChecked(self.settings.get("show_ghost_btn", True))
        display_layout.addWidget(self.show_ghost_btn_check)
        
        display_group.setLayout(display_layout)
        content_layout.addWidget(display_group)
        
        # 主题颜色
        theme_group = QGroupBox("🎨 主题颜色")
        theme_layout = QVBoxLayout()
        
        theme_row = QHBoxLayout()
        theme_row.addWidget(QLabel("主题色:"))
        self.theme_combo = QComboBox()
        self.theme_combo.addItems(["绿色(#4CAF50)", "蓝色(#2196F3)", "紫色(#9C27B0)", 
                                   "橙色(#FF9800)", "粉色(#E91E63)", "青色(#00BCD4)"])
        theme_colors = {"绿色(#4CAF50)": "#4CAF50", "蓝色(#2196F3)": "#2196F3", 
                       "紫色(#9C27B0)": "#9C27B0", "橙色(#FF9800)": "#FF9800",
                       "粉色(#E91E63)": "#E91E63", "青色(#00BCD4)": "#00BCD4"}
        current_theme = self.settings.get("theme_color", "#4CAF50")
        for text, color in theme_colors.items():
            if color == current_theme:
                self.theme_combo.setCurrentText(text)
                break
        theme_row.addWidget(self.theme_combo)
        theme_row.addStretch()
        theme_layout.addLayout(theme_row)
        
        theme_group.setLayout(theme_layout)
        content_layout.addWidget(theme_group)
        
        content_layout.addStretch()
        scroll.setWidget(content)
        
        main_layout = QVBoxLayout(widget)
        main_layout.addWidget(scroll)
        
        return widget
    
    def _create_character_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        
        tabs = QTabWidget()
        
        preset_tab = QWidget()
        preset_layout = QVBoxLayout(preset_tab)
        
        intro = QLabel("选择一个预设角色，快速开始~")
        intro.setStyleSheet("color: gray;")
        preset_layout.addWidget(intro)
        
        self.preset_list = QListWidget()
        for name in PRESET_CHARACTERS.keys():
            char = PRESET_CHARACTERS[name]
            tags = "、".join(char["basic_info"]["role_tags"])
            self.preset_list.addItem(f"{name} ({tags})")
        preset_layout.addWidget(self.preset_list)
        
        preset_btn_layout = QHBoxLayout()
        use_btn = QPushButton("使用此角色")
        use_btn.clicked.connect(self._use_preset)
        preset_btn_layout.addWidget(use_btn)
        
        preview_btn = QPushButton("预览")
        preview_btn.clicked.connect(self._preview_preset)
        preset_btn_layout.addWidget(preview_btn)
        
        preset_layout.addLayout(preset_btn_layout)
        
        custom_tab = QWidget()
        custom_layout = QVBoxLayout(custom_tab)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll_content = QWidget()
        scroll_layout = QVBoxLayout(scroll_content)
        
        name_layout = QHBoxLayout()
        name_layout.addWidget(QLabel("角色名称:"))
        self.name_input = QLineEdit()
        self.name_input.setPlaceholderText("给小助手起个名字吧~")
        name_layout.addWidget(self.name_input)
        scroll_layout.addLayout(name_layout)
        
        backstory_layout = QHBoxLayout()
        backstory_layout.addWidget(QLabel("角色背景:"))
        self.backstory_input = QTextEdit()
        self.backstory_input.setPlaceholderText("描述一下这个角色的来历和身份...")
        self.backstory_input.setMaximumHeight(60)
        backstory_layout.addWidget(self.backstory_input)
        scroll_layout.addLayout(backstory_layout)
        
        tags_group = QGroupBox("🏷️ 性格标签 (可多选)")
        tags_layout = QVBoxLayout()
        self.tag_checkboxes = {}
        
        tags_list_layout = QVBoxLayout()
        tags_per_row = 4
        tags = list(PERSONALITY_TAGS.keys())
        for i in range(0, len(tags), tags_per_row):
            row = QHBoxLayout()
            for tag in tags[i:i+tags_per_row]:
                cb = QCheckBox(tag)
                cb.stateChanged.connect(lambda state, t=tag: self._on_tag_changed(t, state))
                self.tag_checkboxes[tag] = cb
                row.addWidget(cb)
            tags_list_layout.addLayout(row)
        
        tags_layout.addLayout(tags_list_layout)
        
        tag_hint = QLabel("💡 提示：选择2-3个标签混合不同性格")
        tag_hint.setStyleSheet("color: gray; font-size: 11px;")
        tags_layout.addWidget(tag_hint)
        
        tags_group.setLayout(tags_layout)
        scroll_layout.addWidget(tags_group)
        
        preview_group = QGroupBox("👀 角色预览")
        preview_layout = QVBoxLayout()
        
        self.preview_label = QLabel("选择标签后点击预览查看效果...")
        self.preview_label.setAlignment(Qt.AlignCenter)
        self.preview_label.setWordWrap(True)
        self.preview_label.setStyleSheet("""
            QLabel {
                background: #f5f5f5;
                border: 1px solid #ddd;
                border-radius: 8px;
                padding: 10px;
                min-height: 80px;
            }
        """)
        preview_layout.addWidget(self.preview_label)
        
        preview_group.setLayout(preview_layout)
        scroll_layout.addWidget(preview_group)
        
        scroll.setWidget(scroll_content)
        custom_layout.addWidget(scroll)
        
        custom_btn_layout = QHBoxLayout()
        preview_custom_btn = QPushButton("预览")
        preview_custom_btn.clicked.connect(self._preview_custom)
        custom_btn_layout.addWidget(preview_custom_btn)
        
        save_custom_btn = QPushButton("保存角色")
        save_custom_btn.setStyleSheet("""
            QPushButton {
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 6px;
                padding: 8px 16px;
            }
            QPushButton:hover { background: #45a049; }
        """)
        save_custom_btn.clicked.connect(self._save_custom)
        custom_btn_layout.addWidget(save_custom_btn)
        
        custom_layout.addLayout(custom_btn_layout)
        
        tabs.addTab(preset_tab, "📋 预设角色")
        tabs.addTab(custom_tab, "✏️ 自定义角色")
        
        layout.addWidget(tabs)
        
        return widget
    
    def _create_behavior_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content = QWidget()
        content_layout = QVBoxLayout(content)
        
        behavior_group = QGroupBox("🎮 行为设置")
        behavior_layout = QVBoxLayout()
        
        self.speech_check = QCheckBox("启用语音播放")
        self.speech_check.setChecked(self.settings.get("speech_enabled", True))
        behavior_layout.addWidget(self.speech_check)
        
        self.proactive_check = QCheckBox("启用主动说话")
        self.proactive_check.setChecked(self.settings.get("proactive_enabled", True))
        self.proactive_check.stateChanged.connect(self._on_proactive_changed)
        behavior_layout.addWidget(self.proactive_check)
        
        proactive_row = QHBoxLayout()
        proactive_row.addWidget(QLabel("主动说话间隔:"))
        self.proactive_spin = QSpinBox()
        self.proactive_spin.setMinimum(30)
        self.proactive_spin.setMaximum(600)
        self.proactive_spin.setValue(self.settings.get("proactive_interval", 120))
        self.proactive_spin.setSuffix(" 秒")
        proactive_row.addWidget(self.proactive_spin)
        proactive_row.addStretch()
        behavior_layout.addLayout(proactive_row)
        
        self.touch_check = QCheckBox("启用触摸交互")
        self.touch_check.setChecked(self.settings.get("touch_enabled", True))
        behavior_layout.addWidget(self.touch_check)
        
        self.auto_start_check = QCheckBox("开机自动启动")
        self.auto_start_check.setChecked(self.settings.get("auto_start", True))
        behavior_layout.addWidget(self.auto_start_check)
        
        behavior_group.setLayout(behavior_layout)
        content_layout.addWidget(behavior_group)
        
        content_layout.addStretch()
        scroll.setWidget(content)
        
        main_layout = QVBoxLayout(widget)
        main_layout.addWidget(scroll)
        
        return widget
    
    def _create_voice_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content = QWidget()
        content_layout = QVBoxLayout(content)
        
        voice_group = QGroupBox("🔊 语音设置")
        voice_layout = QVBoxLayout()
        
        voice_intro = QLabel("调整语音的语速和音调（基于微软小旭默认音色）")
        voice_intro.setStyleSheet("color: gray;")
        voice_layout.addWidget(voice_intro)
        
        speed_row = QHBoxLayout()
        speed_row.addWidget(QLabel("语速:"))
        self.speed_slider = QSlider(Qt.Horizontal)
        self.speed_slider.setMinimum(-100)
        self.speed_slider.setMaximum(100)
        self.speed_slider.setValue(self.settings.get("voice_speed", 0))
        self.speed_slider.setTickPosition(QSlider.TicksBelow)
        self.speed_slider.setTickInterval(20)
        speed_row.addWidget(self.speed_slider)
        
        self.speed_label = QLabel(f"{self.settings.get('voice_speed', 0):+d}%")
        speed_row.addWidget(self.speed_label)
        self.speed_slider.valueChanged.connect(lambda v: self.speed_label.setText(f"{v:+d}%"))
        voice_layout.addLayout(speed_row)
        
        pitch_row = QHBoxLayout()
        pitch_row.addWidget(QLabel("音调:"))
        self.pitch_slider = QSlider(Qt.Horizontal)
        self.pitch_slider.setMinimum(-50)
        self.pitch_slider.setMaximum(50)
        self.pitch_slider.setValue(self.settings.get("voice_pitch", 0))
        self.pitch_slider.setTickPosition(QSlider.TicksBelow)
        self.pitch_slider.setTickInterval(10)
        pitch_row.addWidget(self.pitch_slider)
        
        self.pitch_label = QLabel(f"{self.settings.get('voice_pitch', 0):+d}%")
        pitch_row.addWidget(self.pitch_label)
        self.pitch_slider.valueChanged.connect(lambda v: self.pitch_label.setText(f"{v:+d}%"))
        voice_layout.addLayout(pitch_row)
        
        voice_group.setLayout(voice_layout)
        content_layout.addWidget(voice_group)
        
        test_group = QGroupBox("🧪 测试语音")
        test_layout = QVBoxLayout()
        
        self.test_text = QLineEdit()
        self.test_text.setText("你好呀，我是你的桌宠小助手~")
        test_layout.addWidget(self.test_text)
        
        test_btn = QPushButton("🔊 播放测试")
        test_btn.clicked.connect(self._test_voice)
        test_layout.addWidget(test_btn)
        
        test_group.setLayout(test_layout)
        content_layout.addWidget(test_group)
        
        content_layout.addStretch()
        scroll.setWidget(content)
        
        main_layout = QVBoxLayout(widget)
        main_layout.addWidget(scroll)
        
        return widget
    
    def _on_size_changed(self, value):
        self.size_label.setText(f"{value}px")
    
    def _on_opacity_changed(self, value):
        self.opacity_label.setText(f"{value}%")
    
    def _on_bubble_opacity_changed(self, value):
        self.bubble_opacity_label.setText(f"{value}%")
    
    def _on_proactive_changed(self, state):
        self.proactive_spin.setEnabled(state == Qt.Checked)
    
    def _on_tag_changed(self, tag, state):
        pass
    
    def _test_voice(self):
        text = self.test_text.text().strip()
        if text:
            from tts_manager import TTSManager
            tts = TTSManager()
            tts.speak(text)
    
    def _use_preset(self):
        item = self.preset_list.currentItem()
        if not item:
            QMessageBox.warning(self, "提示", "请先选择一个预设角色")
            return
        
        index = self.preset_list.row(item)
        preset_names = list(PRESET_CHARACTERS.keys())
        
        if 0 <= index < len(preset_names):
            preset_name = preset_names[index]
            char = CharacterPersona.from_preset(preset_name)
            set_current_character(char)
            QMessageBox.information(self, "成功", f"已切换到「{char.name}」")
            self.settings_changed.emit({"character_changed": True})
    
    def _preview_preset(self):
        item = self.preset_list.currentItem()
        if not item:
            QMessageBox.warning(self, "提示", "请先选择一个预设角色")
            return
        
        index = self.preset_list.row(item)
        preset_names = list(PRESET_CHARACTERS.keys())
        
        if 0 <= index < len(preset_names):
            preset_name = preset_names[index]
            char = CharacterPersona.from_preset(preset_name)
            self._show_preview(char)
    
    def _preview_custom(self):
        name = self.name_input.text().strip() or "小助手"
        tags = [tag for tag, cb in self.tag_checkboxes.items() if cb.isChecked()]
        backstory = self.backstory_input.toPlainText().strip() or "你的贴心伙伴"
        
        if not tags:
            QMessageBox.warning(self, "提示", "请至少选择一个性格标签！")
            return
        
        char = CharacterEditor.create_from_input(name, tags, backstory)
        self._show_preview(char)
    
    def _save_custom(self):
        name = self.name_input.text().strip()
        tags = [tag for tag, cb in self.tag_checkboxes.items() if cb.isChecked()]
        backstory = self.backstory_input.toPlainText().strip()
        
        if not name:
            QMessageBox.warning(self, "提示", "请输入角色名称！")
            return
        
        if not tags:
            QMessageBox.warning(self, "提示", "请至少选择一个性格标签！")
            return
        
        char = CharacterEditor.create_from_input(name, tags, backstory)
        set_current_character(char)
        QMessageBox.information(self, "成功", f"角色「{name}」已保存并应用！")
        self.settings_changed.emit({"character_changed": True})
    
    def _show_preview(self, char):
        preview_text = f"""【{char.name}】
性格: {'、'.join(char.tags)}
背景: {char.backstory}

--- 模拟回复 ---
打招呼: {char.get_response('greeting')}
开心: {char.get_response('happy')}
安慰: {char.get_response('comfort')}
被摸头: {char.get_touch_response()}
"""
        self.preview_label.setText(preview_text)
    
    def _reset_settings(self):
        reply = QMessageBox.question(self, "确认", "确定要恢复默认设置吗？")
        if reply == QMessageBox.Yes:
            global _settings_instance
            _settings_instance = PetSettings()
            self.settings = _settings_instance
            self._load_current_character()
            self._init_ui()
            QMessageBox.information(self, "成功", "已恢复默认设置")
    
    def _load_current_character(self):
        character = get_current_character()
        self.name_input.setText(character.name)
        self.backstory_input.setText(character.backstory)
        
        for tag, cb in self.tag_checkboxes.items():
            cb.setChecked(tag in character.tags)
    
    def _save_settings(self):
        # 保存外观设置
        self.settings.set("pet_size", self.size_slider.value())
        self.settings.set("pet_opacity", self.opacity_slider.value() / 100)
        self.settings.set("bubble_opacity", self.bubble_opacity_slider.value() / 100)
        self.settings.set("bubble_max_width", self.bubble_width_spin.value())
        self.settings.set("bubble_font_size", self.bubble_font_spin.value())
        self.settings.set("bubble_duration", self.bubble_duration_spin.value())
        self.settings.set("show_cpu", self.show_cpu_check.isChecked())
        self.settings.set("show_status", self.show_status_check.isChecked())
        self.settings.set("show_input", self.show_input_check.isChecked())
        self.settings.set("show_ghost_btn", self.show_ghost_btn_check.isChecked())
        theme_colors = {"绿色(#4CAF50)": "#4CAF50", "蓝色(#2196F3)": "#2196F3", 
                       "紫色(#9C27B0)": "#9C27B0", "橙色(#FF9800)": "#FF9800",
                       "粉色(#E91E63)": "#E91E63", "青色(#00BCD4)": "#00BCD4"}
        self.settings.set("theme_color", theme_colors.get(self.theme_combo.currentText(), "#4CAF50"))
        
        # 保存行为设置
        self.settings.set("speech_enabled", self.speech_check.isChecked())
        self.settings.set("proactive_enabled", self.proactive_check.isChecked())
        self.settings.set("proactive_interval", self.proactive_spin.value())
        self.settings.set("touch_enabled", self.touch_check.isChecked())
        self.settings.set("auto_start", self.auto_start_check.isChecked())
        
        # 保存语音设置
        self.settings.set("voice_speed", self.speed_slider.value())
        self.settings.set("voice_pitch", self.pitch_slider.value())
        
        self.settings.save()
        
        changes = {
            "size": self.size_slider.value(),
            "opacity": self.opacity_slider.value() / 100,
            "bubble_opacity": self.bubble_opacity_slider.value() / 100,
            "bubble_width": self.bubble_width_spin.value(),
            "bubble_font_size": self.bubble_font_spin.value(),
            "bubble_duration": self.bubble_duration_spin.value(),
            "show_cpu": self.show_cpu_check.isChecked(),
            "show_status": self.show_status_check.isChecked(),
            "show_input": self.show_input_check.isChecked(),
            "show_ghost_btn": self.show_ghost_btn_check.isChecked(),
            "speech_enabled": self.speech_check.isChecked(),
            "proactive_enabled": self.proactive_check.isChecked(),
            "proactive_interval": self.proactive_spin.value(),
            "touch_enabled": self.touch_check.isChecked(),
            "voice_speed": self.speed_slider.value(),
            "voice_pitch": self.pitch_slider.value(),
        }
        
        self.settings_changed.emit(changes)
        QMessageBox.information(self, "成功", "设置已保存！")
        self.close()


class CharacterQuickSelect(QDialog):
    """快速切换角色对话框"""
    
    character_selected = pyqtSignal(str)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("切换角色")
        self.setMinimumSize(450, 350)
        self._init_ui()
        self._load_characters()
    
    def _init_ui(self):
        layout = QVBoxLayout(self)
        
        title = QLabel("🎭 选择角色")
        title.setFont(QFont("Microsoft YaHei", 12, QFont.Bold))
        title.setAlignment(Qt.AlignCenter)
        layout.addWidget(title)
        
        tabs = QTabWidget()
        
        preset_tab = QWidget()
        preset_layout = QVBoxLayout(preset_tab)
        self.preset_quick_list = QListWidget()
        for name in PRESET_CHARACTERS.keys():
            char = PRESET_CHARACTERS[name]
            tags = "、".join(char["basic_info"]["role_tags"])
            self.preset_quick_list.addItem(f"{name} ({tags})")
        self.preset_quick_list.itemDoubleClicked.connect(self._on_select_preset)
        preset_layout.addWidget(self.preset_quick_list)
        
        preset_btn = QPushButton("使用此预设角色")
        preset_btn.clicked.connect(lambda: self._on_select_preset(self.preset_quick_list.currentItem()))
        preset_layout.addWidget(preset_btn)
        
        custom_tab = QWidget()
        custom_layout = QVBoxLayout(custom_tab)
        self.char_list = QListWidget()
        self.char_list.itemDoubleClicked.connect(self._on_select)
        custom_layout.addWidget(self.char_list)
        
        custom_btn_layout = QHBoxLayout()
        refresh_btn = QPushButton("刷新")
        refresh_btn.clicked.connect(self._load_characters)
        custom_btn_layout.addWidget(refresh_btn)
        
        new_btn = QPushButton("新建角色")
        new_btn.clicked.connect(self._on_new)
        custom_btn_layout.addWidget(new_btn)
        
        custom_layout.addLayout(custom_btn_layout)
        
        tabs.addTab(preset_tab, "📋 预设角色")
        tabs.addTab(custom_tab, "📁 我的角色")
        
        layout.addWidget(tabs)
        
        close_btn = QPushButton("关闭")
        close_btn.clicked.connect(self.close)
        layout.addWidget(close_btn)
    
    def _load_characters(self):
        self.char_list.clear()
        
        characters = CharacterPersona.list_characters()
        
        if not characters:
            self.char_list.addItem("暂无角色，点击「新建角色」创建一个~")
            return
        
        for char in characters:
            tags_str = "、".join(char["tags"])
            self.char_list.addItem(f"{char['name']} ({tags_str})")
    
    def _on_select_preset(self, item):
        if not item:
            return
        
        index = self.preset_quick_list.row(item)
        preset_names = list(PRESET_CHARACTERS.keys())
        
        if 0 <= index < len(preset_names):
            preset_name = preset_names[index]
            char = CharacterPersona.from_preset(preset_name)
            set_current_character(char)
            self.character_selected.emit("preset:" + preset_name)
            self.close()
    
    def _on_select(self, item):
        index = self.char_list.row(item)
        characters = CharacterPersona.list_characters()
        if 0 <= index < len(characters):
            char = CharacterPersona.load(characters[index]["filepath"])
            set_current_character(char)
            self.character_selected.emit(characters[index]["filepath"])
            self.close()
    
    def _on_new(self):
        dialog = SettingsDialog(self)
        dialog.settings_changed.connect(self._load_characters)
        dialog.exec_()
