"""
简洁的TTS语音系统 - 只播放纯文本回复
修复了语音不播放的问题
"""
import os
import re
import time
import asyncio
import edge_tts
import tempfile
import threading
import ctypes
import queue

class TTSManager:
    def __init__(self):
        self._is_speaking = False
        self._speech_lock = threading.Lock()
        self._speech_queue = queue.Queue()
        self._current_text = None
        
    def speak(self, text, on_start=None, on_end=None):
        if not text or not text.strip():
            return
        
        text = text.strip()
        
        # ========== 严格验证：只接受纯自然语言文本 ==========
        
        # 1. 必须是纯中文/纯文字（可以有标点符号和少量emoji）
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        letters = len(re.findall(r'[a-zA-Z]', text))
        valid_chars = chinese_chars + letters
        
        if valid_chars < len(text) * 0.5:
            print(f"[TTS拒绝] 非文字内容: {text[:50]}")
            return
        
        # 2. 拒绝包含技术符号的内容
        tech_chars = ['{', '}', '[', ']', ':', '=', '<', '>', '/', '\\', '|', '@', '#', '$', '%', '^', '&', '*', '(', ')', '+', '"', "'"]
        if any(c in text for c in tech_chars):
            print(f"[TTS拒绝] 技术符号: {text[:50]}")
            return
        
        # 3. 允许中文日期时间，拒绝技术数字
        if re.search(r'\d', text):
            tech_number_patterns = [
                r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}',  # IP地址
                r'\d+%',  # 百分比
                r'v\d+\.\d+',  # 版本号
            ]
            text_lower = text.lower()
            if any(re.search(p, text_lower) for p in tech_number_patterns):
                print(f"[TTS拒绝] 技术数字: {text[:50]}")
                return
        
        # 4. 拒绝包含英文技术关键词的内容
        tech_keywords = [
            'error', 'exception', 'traceback', 'forbidden', 'unauthorized',
            'invalid', 'quota', 'balance', 'sorry', 'account', 'message',
            'rate limit', 'timeout', 'latency', 'delay', 'status', 'code',
            'http', 'response', 'request', 'api', 'key', 'url', 'json',
            'ms', '毫秒', '秒', '分钟', '延迟', '耗时', '用时'
        ]
        text_lower = text.lower()
        if any(kw in text_lower for kw in tech_keywords):
            print(f"[TTS拒绝] 技术关键词: {text[:50]}")
            return
        
        # 5. 文本长度检查
        if len(text) < 2:
            print(f"[TTS拒绝] 文本太短: {text}")
            return
        
        # 6. 移除表情符号（Emoji）用于TTS播放
        # 只匹配明确的Emoji范围，避免误删中文
        emoji_ranges = [
            (0x1F600, 0x1F64F),  # emoticons
            (0x1F300, 0x1F5FF),  # symbols & pictographs
            (0x1F680, 0x1F6FF),  # transport & map symbols
            (0x1F1E0, 0x1F1FF),  # flags
            (0x2702, 0x27B0),    # dingbats
            (0x1F900, 0x1F9FF),  # supplemental symbols
            (0x1FA00, 0x1FA6F),  # chess symbols
            (0x1FA70, 0x1FAFF),  # extended symbols
            (0x2600, 0x26FF),    # misc symbols
            (0x2700, 0x27BF),    # more dingbats
        ]
        
        emoji_pattern_parts = []
        for start, end in emoji_ranges:
            emoji_pattern_parts.append(f'{chr(start)}-{chr(end)}')
        emoji_pattern = re.compile(f'[{"".join(emoji_pattern_parts)}]+')
        text_for_speech = emoji_pattern.sub('', text)
        
        # 清理多余的空格和标点
        text_for_speech = re.sub(r'\s+', ' ', text_for_speech).strip()
        
        if len(text_for_speech) < 2:
            print(f"[TTS拒绝] 表情太多: {text[:30]}")
            return
        
        # 验证通过，加入队列（使用移除表情后的文本）
        self._speech_queue.put((text_for_speech, on_start, on_end))
        
        # 确保处理线程在运行
        if not self._is_speaking:
            self._start_processing()
        
        print(f"[TTS排队] {text[:30]}...")
    
    def _start_processing(self):
        self._is_speaking = True
        thread = threading.Thread(target=self._process_queue, daemon=True)
        thread.start()
    
    def _process_queue(self):
        while True:
            try:
                # 等待获取队列中的下一条消息，最多等待2秒
                try:
                    text, on_start, on_end = self._speech_queue.get(timeout=2)
                except queue.Empty:
                    # 队列空了，退出
                    self._is_speaking = False
                    return
                
                self._current_text = text
                
                # 执行回调
                if on_start:
                    try:
                        on_start()
                    except Exception as e:
                        print(f"[TTS] on_start error: {e}")
                
                # 播放语音
                self._do_speak(text)
                
                # 播放完成回调
                if on_end:
                    try:
                        on_end()
                    except Exception as e:
                        print(f"[TTS] on_end error: {e}")
                
                self._current_text = None
                
                # 检查队列是否还有内容
                if self._speech_queue.empty():
                    self._is_speaking = False
                    return
                    
            except Exception as e:
                print(f"[TTS] Queue processing error: {e}")
                self._is_speaking = False
                return
    
    def _do_speak(self, text):
        tmp = None
        try:
            tmp = tempfile.NamedTemporaryFile(suffix='.mp3', delete=False)
            tmp_path = tmp.name
            tmp.close()
            
            # 生成语音
            asyncio.run(edge_tts.Communicate(text, "zh-CN-XiaoxiaoNeural").save(tmp_path))
            
            # 播放
            self._play_mp3(tmp_path)
            print(f"[TTS播放完成] {text[:20]}...")
            
        except Exception as e:
            print(f"[TTS] Speak error: {e}")
        finally:
            if tmp and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except:
                    pass
    
    def _play_mp3(self, path):
        mci = ctypes.windll.winmm.mciSendStringW
        buf = ctypes.create_unicode_buffer(256)
        path_escaped = path.replace('\\', '\\\\')
        
        try:
            # 关闭可能存在的旧实例
            mci('close pet_audio', buf, 256, None)
        except:
            pass
        
        try:
            mci(f'open "{path_escaped}" type mpegvideo alias pet_audio', buf, 256, None)
            mci('play pet_audio', buf, 256, None)
            
            while True:
                time.sleep(0.1)
                mci('status pet_audio mode', buf, 256, None)
                if buf.value != 'playing':
                    break
        except Exception as e:
            print(f"[TTS] MCI playback error: {e}")
        finally:
            try:
                mci('close pet_audio', buf, 256, None)
            except:
                pass
    
    def stop(self):
        """停止当前播放"""
        mci = ctypes.windll.winmm.mciSendStringW
        buf = ctypes.create_unicode_buffer(256)
        try:
            mci('close pet_audio', buf, 256, None)
        except:
            pass
        self._is_speaking = False
        
        # 清空队列
        while not self._speech_queue.empty():
            try:
                self._speech_queue.get_nowait()
            except:
                break
    
    def is_playing(self):
        """检查是否正在播放"""
        return self._is_speaking and self._current_text is not None
