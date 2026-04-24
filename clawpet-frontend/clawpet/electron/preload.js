/**
 * Electron 预加载脚本（Preload Script）
 * 
 * 作用：
 * 1. 在网页加载之前运行，作为主进程和渲染进程之间的安全桥梁
 * 2. 通过 contextBridge 暴露有限的 API 给渲染进程（网页）
 * 3. 防止网页直接访问 Node.js API（如 require('fs')），保证安全
 * 
 * 安全机制：
 * - contextIsolation: true（上下文隔离）
 * - nodeIntegration: false（禁用 Node.js 集成）
 * - 只暴露预定义的 API，网页无法篡改
 * 
 * 运行时机：
 * 每个窗口（BrowserWindow）加载网页时，先运行 preload.js，再加载网页
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 暴露 electronAPI 到全局 window 对象
 * 渲染进程（网页）可以通过 window.electronAPI 调用这些方法
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ==================== 环境信息 ====================
  
  /**
   * 获取后端服务地址
   * @returns {string} 后端 URL（默认 http://127.0.0.1:18790）
   */
  getBackendBaseUrl: () => process.env.GOCLAW_BACKEND_URL || 'http://127.0.0.1:18790',

  /**
   * 获取前端 API 基地址（Launcher API）
   * @returns {string} API URL（默认 http://127.0.0.1:18800）
   */
  getApiBaseUrl: () => process.env.GOCLAW_API_URL || process.env.GOCLAW_BACKEND_URL || 'http://127.0.0.1:18800',
  
  /**
   * 获取启动器 Token（用于身份验证）
   * @returns {string} Token 字符串
   */
  getLauncherToken: () => process.env.GOCLAW_LAUNCHER_TOKEN || process.env.PICOCLAW_LAUNCHER_TOKEN || '',
  
  // ==================== 引导相关 ====================
  
  /**
   * 打开引导窗口（首次使用向导）
   * 向主进程发送 'open-onboarding' 消息
   */
  openOnboarding: () => ipcRenderer.send('open-onboarding'),
  
  /**
   * 设置引导模式
   * @param {boolean} enabled - 是否启用引导模式
   */
  setOnboardingMode: (enabled) => ipcRenderer.send('set-onboarding-mode', Boolean(enabled)),

  /**
   * 完成引导流程
   * 通知主进程解除 onboarding 锁并打开控制台页面
   */
  completeOnboarding: () => ipcRenderer.send('complete-onboarding'),
  
  // ==================== 窗口控制 ====================
  
  /**
   * 最小化当前窗口
   */
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  
  /**
   * 切换窗口最大化/还原状态
   */
  toggleMaximizeWindow: () => ipcRenderer.send('window-toggle-maximize'),
  
  /**
   * 关闭当前窗口
   */
  closeWindow: () => ipcRenderer.send('window-close'),
  
  // ==================== 设置窗口 ====================
  
  /**
   * 打开设置窗口（控制面板）
   */
  openSettings: () => ipcRenderer.send('open-settings'),
  
  /**
   * 最小化设置窗口
   */
  minimizeSettings: () => ipcRenderer.send('minimize-settings'),
  
  /**
   * 最大化/还原设置窗口
   */
  maximizeSettings: () => ipcRenderer.send('maximize-settings'),
  
  /**
   * 关闭设置窗口
   */
  closeSettings: () => ipcRenderer.send('close-settings'),
  
  // ==================== 数据发送 ====================
  
  /**
   * 发送设置变更通知
   * @param {object} settings - 新的设置内容
   */
  sendSettingsChange: (settings) => ipcRenderer.send('settings-changed', settings),
  
  /**
   * 发送聊天历史记录
   * @param {Array} history - 聊天历史数组
   */
  sendChatHistory: (history) => ipcRenderer.send('chat-history', history),
  
  /**
   * 显示气泡消息（桌宠说话）
   * 
   * 使用方式：
   * window.electronAPI.showBubble('你好呀~', 'happy')
   * window.electronAPI.showBubble({ text: '你好', emotion: 'happy', audio: 'base64...' })
   * 
   * @param {string|object} payloadOrText - 气泡内容（字符串或对象）
   * @param {string} emotion - 情绪（可选）
   * @param {string} audio - 音频 base64（可选）
   */
  showBubble: (payloadOrText, emotion, audio) => {
    // 判断是对象还是字符串
    const payload =
      payloadOrText && typeof payloadOrText === 'object'
        ? payloadOrText  // 已经是对象，直接使用
        : { text: payloadOrText ?? null, emotion, audio }  // 字符串，构建对象
    
    // 发送给主进程
    ipcRenderer.send('show-bubble', payload)
  },
  
  /**
   * 发送连接活跃状态（心跳）
   */
  sendConnectionAlive: () => ipcRenderer.send('connection-alive'),
  
  // ==================== 事件监听 ====================
  
  /**
   * 监听设置更新事件
   * @param {function} callback - 回调函数，接收设置对象
   */
  onSettingsUpdate: (callback) => {
    // 监听主进程发来的 'settings-updated' 消息
    ipcRenderer.on('settings-updated', (_event, settings) => callback(settings));
  },
  
  /**
   * 监听聊天历史更新事件
   * @param {function} callback - 回调函数，接收聊天历史
   */
  onChatHistoryUpdate: (callback) => {
    ipcRenderer.on('chat-history-updated', (_event, history) => callback(history));
  },
  
  /**
   * 监听气泡显示事件（桌宠要说话了）
   * @param {function} callback - 回调函数，接收气泡数据
   * 
   * 使用示例：
   * window.electronAPI.onBubbleShow((data) => {
   *   console.log('桌宠说:', data.text)
   *   console.log('情绪:', data.emotion)
   * })
   */
  onBubbleShow: (callback) => {
    ipcRenderer.on('bubble-show', (_event, data) => callback(data));
  },
  
  /**
   * 监听连接活跃状态
   * @param {function} callback - 回调函数
   */
  onConnectionAlive: (callback) => {
    ipcRenderer.on('connection-alive', () => callback());
  },
  
  /**
   * 监听启动进度更新
   * @param {function} callback - 回调函数，接收进度数据
   * 
   * 进度数据示例：
   * {
   *   done: false,
   *   percent: 50,
   *   title: '正在启动 ClawPet',
   *   subtitle: '准备后端与桌面面板，请稍候…',
   *   steps: [...]
   * }
   */
  onStartupProgress: (callback) => {
    ipcRenderer.on('startup-progress', (_event, payload) => callback(payload));
  },
  
  // ==================== 异步调用 ====================
  
  /**
   * 获取当前启动状态
   * @returns {Promise<object>} 启动状态对象
   */
  getStartupState: () => ipcRenderer.invoke('startup-state')
});
