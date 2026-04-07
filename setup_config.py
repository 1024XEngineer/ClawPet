"""
GoClaw 配置脚本 - 用于设置 API Key
"""
import os
import json
import sys

def load_env():
    """从 .env 文件加载环境变量"""
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_file):
        print("警告: .env 文件不存在，请创建并填入 API Key")
        return False
    
    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key.strip()] = value.strip()
    return True

def update_picoclaw_config():
    """更新 picoclaw 配置"""
    api_key = os.environ.get('PICOCLAW_API_KEY', '')
    if not api_key:
        print("警告: PICOCLAW_API_KEY 未设置")
        return False
    
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'picoclaw_data', 'config.json')
    
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
    else:
        config = {
            "version": 2,
            "agents": {
                "defaults": {
                    "model_name": "glm-4.7",
                    "workspace": os.path.dirname(os.path.abspath(__file__)) + "\\picoclaw_data\\workspace",
                    "restrict_to_workspace": False
                }
            },
            "model_list": [
                {
                    "model_name": "glm-4.7",
                    "model": "zhipu/glm-4.7",
                    "api_base": "https://open.bigmodel.cn/api/paas/v4",
                    "api_keys": [api_key]
                }
            ],
            "tools": {
                "web": {"enabled": True, "duckduckgo": {"enabled": True, "max_results": 5}},
                "exec": {"enabled": True, "allow_remote": True, "timeout_seconds": 60},
                "cron": {"enabled": True, "exec_timeout_minutes": 5},
                "read_file": {"enabled": True},
                "write_file": {"enabled": True},
                "list_dir": {"enabled": True}
            }
        }
    
    if 'model_list' in config and len(config['model_list']) > 0:
        config['model_list'][0]['api_keys'] = [api_key]
    
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    
    print(f"PicoClaw 配置已更新")
    return True

def update_ai_manager():
    """更新 ai_manager.py 中的 API Key（如果需要）"""
    print("AI Manager 使用 ZHIPU_API_KEY 环境变量")

if __name__ == '__main__':
    if load_env():
        update_picoclaw_config()
        update_ai_manager()
        print("配置完成！")
    else:
        print("请创建 .env 文件并填入 API Key")
        sys.exit(1)
