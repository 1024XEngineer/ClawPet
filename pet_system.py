"""
宠物系统 - 记忆、属性和行为
"""
import os
import json
import time
import random
from datetime import datetime, timedelta
from PyQt5.QtCore import QTimer


PET_STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pet_state.json')
PET_MEMORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pet_memory.json')


class JsonStorage:
    def __init__(self, file_path):
        self.file_path = file_path

    def load(self, key):
        if not os.path.exists(self.file_path):
            return None
        try:
            with open(self.file_path, 'r', encoding='utf-8') as f:
                return json.load(f).get(key)
        except:
            return None

    def save(self, key, data):
        existing = {}
        if os.path.exists(self.file_path):
            try:
                with open(self.file_path, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            except:
                pass
        existing[key] = data
        with open(self.file_path, 'w', encoding='utf-8') as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)


class PetAttributes:
    def __init__(self, storage=None):
        self.storage = storage or JsonStorage(PET_STATE_FILE)
        self.affection = 50
        self.mood = 70
        self.energy = 100
        self.intimacy = 30
        self.curiosity = 60
        self.playfulness = 50
        self.stress = 10
        self.hunger = 20
        self.load()

    def load(self):
        data = self.storage.load('attributes')
        if data:
            for key in data:
                if hasattr(self, key):
                    setattr(self, key, data[key])

    def save(self):
        data = {k: getattr(self, k) for k in ['affection', 'mood', 'energy', 'intimacy', 'curiosity', 'playfulness', 'stress', 'hunger']}
        self.storage.save('attributes', data)

    def clamp(self):
        for attr in ['affection', 'mood', 'energy', 'intimacy', 'curiosity', 'playfulness', 'stress', 'hunger']:
            val = getattr(self, attr)
            setattr(self, attr, max(0, min(100, val)))

    def get_mood_state(self):
        if self.energy < 20: return "sleepy"
        if self.stress > 70: return "stressed"
        if self.mood > 80: return "happy"
        if self.mood < 30: return "sad"
        if self.hunger > 70: return "hungry"
        return "normal"


class UnifiedMemory:
    CATEGORIES = {'personality': '用户性格特点', 'preference': '用户喜好', 'event': '重要事件', 'scene': '场景状态'}
    CATEGORY_KEYWORDS = {
        'personality': ['性格', '喜欢', '讨厌', '觉得', '感觉', '心情'],
        'preference': ['喜欢', '爱', '想要', '习惯', '偏爱', '最爱'],
        'event': ['今天', '昨天', '明天', '考试', '工作', '生日', '旅行'],
        'scene': ['在公司', '在学校', '在家', '下雨', '天晴', '热', '冷']
    }

    def __init__(self, storage=None):
        self.storage = storage or JsonStorage(PET_MEMORY_FILE)
        self.short_term = []
        self.unified_memory = []
        self.last_interaction = None
        self.conversation_count = 0
        self.load()

    def load(self):
        self.short_term = self.storage.load('short_term') or []
        self.unified_memory = self.storage.load('unified_memory') or []
        self.last_interaction = self.storage.load('last_interaction')
        self.conversation_count = self.storage.load('conversation_count') or 0

    def save(self):
        self.storage.save('short_term', self.short_term[-50:])
        self.storage.save('unified_memory', self.unified_memory)
        self.storage.save('last_interaction', self.last_interaction)
        self.storage.save('conversation_count', self.conversation_count)

    def _classify(self, text):
        scores = {cat: 0 for cat in self.CATEGORIES}
        for cat, keywords in self.CATEGORY_KEYWORDS.items():
            for kw in keywords:
                if kw in text:
                    scores[cat] += 1
        max_score = max(scores.values()) if scores else 0
        return max(scores, key=scores.get) if max_score > 0 else 'personality'

    def _calculate_importance(self, text):
        importance = 0.5
        if any(w in text for w in ['非常', '特别', '极其', '超级']):
            importance += 0.2
        if any(w in text for w in ['不', '没', '别', '讨厌', '恨']):
            importance += 0.1
        if any(w in text for w in ['今天', '昨天', '考试', '生日', '工作']):
            importance += 0.15
        return min(1.0, max(0.1, importance))

    def add_interaction(self, user_text, pet_reply):
        self.short_term.append({'time': time.time(), 'user': user_text, 'pet': pet_reply})
        self.last_interaction = time.time()
        self.conversation_count += 1

        combined = f"{user_text} {pet_reply}"
        if len(user_text) > 5:
            self.unified_memory.append({
                'content': user_text[:50].strip(),
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M'),
                'category': self._classify(user_text),
                'importance': self._calculate_importance(user_text)
            })
        self.save()

    def get_memory_context(self):
        contexts = []
        for cat in ['event', 'preference', 'personality']:
            memories = sorted([m for m in self.unified_memory if m['category'] == cat], key=lambda x: x['importance'], reverse=True)[:2]
            if memories:
                entries = ' | '.join([m['content'] for m in memories])
                contexts.append(f"[{self.CATEGORIES[cat]}] {entries}")
        return '\n'.join(contexts) if contexts else ''

    def get_recent_topics(self, count=5):
        return [item['user'] for item in self.short_term[-count:]]

    def get_time_since_last_interaction(self):
        if not self.last_interaction:
            return 999
        return (time.time() - self.last_interaction) / 3600


PetMemory = UnifiedMemory


class PetBehavior:
    def __init__(self, attributes, memory):
        self.attrs = attributes
        self.memory = memory
        self._proactive_timer = None
        self._action_timer = None
        self._callbacks = {'on_speak': None, 'on_action': None}

    def set_callback(self, event, callback):
        if event in self._callbacks:
            self._callbacks[event] = callback

    def start(self):
        self._schedule_proactive()
        self._schedule_random_action()

    def stop(self):
        if self._proactive_timer:
            self._proactive_timer.stop()
        if self._action_timer:
            self._action_timer.stop()

    def _schedule_proactive(self):
        base_delay = 120
        affection_factor = max(0.3, 1 - self.attrs.affection / 150)
        curiosity_factor = max(0.5, 1 - self.attrs.curiosity / 200)
        delay = max(30, min(300, base_delay * affection_factor * curiosity_factor + random.uniform(-20, 20)))

        if not self._proactive_timer:
            self._proactive_timer = QTimer()
            self._proactive_timer.setSingleShot(True)
            self._proactive_timer.timeout.connect(self._do_proactive)
        self._proactive_timer.start(int(delay * 1000))

    def _do_proactive(self):
        if not self._callbacks.get('on_speak'):
            return

        mood = self.attrs.get_mood_state()
        hours_idle = self.memory.get_time_since_last_interaction()
        messages = []

        if hours_idle > 2:
            messages.extend(["主人好久没理我了...", "你终于回来啦！", "哼，这么久不找我！"])
        elif hours_idle > 0.5:
            messages.extend(["主人刚才在忙什么呀？", "我好无聊哦，陪我聊聊天嘛~", "今天过得开心吗？"])

        if mood == "happy":
            messages.extend(["今天心情超好的！想和主人分享快乐~", "嘿嘿，突然想唱歌给你听呢"])
        elif mood == "sleepy":
            messages.extend(["好困啊...主人让我睡一会儿好不好", "眼睛都快睁不开了..."])
        elif mood == "hungry":
            messages.extend(["肚子好饿...主人什么时候给我好吃的呀", "我想吃小蛋糕..."])

        if self.attrs.curiosity > 60:
            messages.extend(["主人，你说世界上真的有外星人吗？", "如果我能变成人类，第一件事要做什么呢？"])

        if messages:
            self._callbacks['on_speak'](random.choice(messages), proactive=True)
        self._schedule_proactive()

    def _schedule_random_action(self):
        base_delay = 60
        playfulness_factor = max(0.4, 1 - self.attrs.playfulness / 150)
        delay = max(20, min(180, base_delay * playfulness_factor + random.uniform(-10, 10)))

        if not self._action_timer:
            self._action_timer = QTimer()
            self._action_timer.setSingleShot(True)
            self._action_timer.timeout.connect(self._do_random_action)
        self._action_timer.start(int(delay * 1000))

    def _do_random_action(self):
        if not self._callbacks.get('on_action'):
            return
        mood = self.attrs.get_mood_state()
        actions = {"happy": ["dance", "sing", "spin"], "sleepy": ["yawn", "sleep", "stretch"], "hungry": ["rub_belly"], "stressed": ["sigh", "pace"]}.get(mood, ["look_around", "stretch", "wiggle", "blink"])
        if actions:
            self._callbacks['on_action'](random.choice(actions))
        self._schedule_random_action()

    def on_user_interaction(self, user_text):
        self.attrs.affection = min(100, self.attrs.affection + 2)
        self.attrs.mood = min(100, self.attrs.mood + 3)
        self.attrs.energy = max(0, self.attrs.energy - 1)
        self.attrs.stress = max(0, self.attrs.stress - 2)
        self.attrs.clamp()
        self.attrs.save()
        if self._proactive_timer:
            self._proactive_timer.stop()
            self._schedule_proactive()
