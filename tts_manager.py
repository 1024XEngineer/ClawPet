"""
TTS语音系统 - 使用Edge TTS
"""
import os
import re
import time
import asyncio
import tempfile
import threading
import ctypes
import queue


class TTSManager:
    def __init__(self):
        self._is_speaking = False
        self._speech_queue = queue.Queue()

    def speak(self, text):
        if not text or not text.strip():
            return

        text = text.strip()
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        if chinese_chars < len(text) * 0.5:
            return

        tech_chars = ['{', '}', '[', ']', ':', '=', '<', '>', '/', '\\', '|', '@', '#', '$', '%', '^', '&', '*', '(', ')', '+']
        if any(c in text for c in tech_chars):
            return

        emoji_ranges = [(0x1F600, 0x1F64F), (0x1F300, 0x1F5FF), (0x1F680, 0x1F6FF), (0x1F1E0, 0x1F1FF), (0x2702, 0x27B0), (0x1F900, 0x1F9FF), (0x2600, 0x26FF), (0x2700, 0x27BF)]
        emoji_chars = ''.join(chr(c) for start, end in emoji_ranges for c in range(start, end + 1))
        text_for_speech = re.sub(f'[{emoji_chars}]+', '', text)
        text_for_speech = re.sub(r'\s+', ' ', text_for_speech).strip()

        if len(text_for_speech) < 2:
            return

        self._speech_queue.put(text_for_speech)
        if not self._is_speaking:
            self._is_speaking = True
            threading.Thread(target=self._process_queue, daemon=True).start()

    def _process_queue(self):
        import edge_tts
        while True:
            try:
                try:
                    text = self._speech_queue.get(timeout=2)
                except queue.Empty:
                    self._is_speaking = False
                    return

                try:
                    tmp = tempfile.NamedTemporaryFile(suffix='.mp3', delete=False)
                    tmp_path = tmp.name
                    tmp.close()
                    asyncio.run(edge_tts.Communicate(text, "zh-CN-XiaoxiaoNeural").save(tmp_path))
                    self._play_mp3(tmp_path)
                finally:
                    if os.path.exists(tmp_path):
                        try:
                            os.unlink(tmp_path)
                        except:
                            pass

                if self._speech_queue.empty():
                    self._is_speaking = False
                    return
            except Exception as e:
                print(f"[TTS] Error: {e}")
                self._is_speaking = False
                return

    def _play_mp3(self, path):
        mci = ctypes.windll.winmm.mciSendStringW
        buf = ctypes.create_unicode_buffer(256)
        path_escaped = path.replace('\\', '\\\\')

        try:
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
            print(f"[TTS] MCI error: {e}")
        finally:
            try:
                mci('close pet_audio', buf, 256, None)
            except:
                pass

    def stop(self):
        mci = ctypes.windll.winmm.mciSendStringW
        buf = ctypes.create_unicode_buffer(256)
        try:
            mci('close pet_audio', buf, 256, None)
        except:
            pass
        self._is_speaking = False
        while not self._speech_queue.empty():
            try:
                self._speech_queue.get_nowait()
            except:
                break
