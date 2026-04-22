package voice

// VoiceParams 语音合成参数
// 控制合成语音的各种属性
type VoiceParams struct {
	Speed float64 // 语速倍率，1.0为正常速度，范围[0.5, 2.0]
	Vol   float64 // 音量倍率，1.0为正常音量，范围(0, 10]
	Pitch int     // 音调偏移，0为正常音调，范围[-12, 12]
}

// AudioChunk 音频数据块
// 流式合成时，每次返回的一个音频片段
type AudioChunk struct {
	Data   []byte     // 音频数据（MP3格式）
	IsLast bool       // 是否为最后一个数据块
	Info   *AudioInfo // 音频元信息（仅在最后一帧时有效）
}

// AudioInfo 音频元数据信息
// 包含音频的各种参数信息
type AudioInfo struct {
	Length     int    // 音频时长（毫秒）
	SampleRate int    // 采样率（Hz）
	Size       int    // 音频文件大小（字节）
	Bitrate    int    // 比特率（bps）
	Format     string // 音频格式，如"mp3", "pcm", "wav"
	Channel    int    // 声道数，1为单声道，2为立体声
}

// DefaultVoiceParams 返回默认的语音参数
func DefaultVoiceParams() VoiceParams {
	return VoiceParams{
		Speed: 1.0,
		Vol:   1.0,
		Pitch: 0,
	}
}

// StreamingTTS 流式语音合成接口
// 支持边合成边输出音频数据
type StreamingTTS interface {
	// Synthesize 执行语音合成
	// text: 要合成的文本内容
	// params: 语音参数（语速、音量、音调、情感等）
	// 返回: 音频块通道，合成过程中不断推送音频数据块
	Synthesize(text string, params VoiceParams) (<-chan AudioChunk, error)
	// Close 关闭TTS连接并释放资源
	Close() error
}

// AudioSegment 语音片段，用于优先队列播放控制
type AudioSegment struct {
	Seq       int64  // 序号，按顺序播放
	Text      string // 对应文本
	AudioData []byte // 缓存的音频数据（合成完毕后填充）
	Duration  int    // 时长（毫秒），从 AudioInfo.Length 获取
	Ready     bool   // 是否合成完毕
	Sent      bool   // 是否已发送
	Error     string // 错误信息（如果有）
}

// MinimaxVoiceInfo MiniMax 音色信息
type MinimaxVoiceInfo struct {
	VoiceID   string   `json:"voice_id"`
	VoiceName string   `json:"voice_name"`
	Desc      []string `json:"description"`
}

// MinimaxVoicesResp MiniMax 音色列表响应
type MinimaxVoicesResp struct {
	SystemVoice     []MinimaxVoiceInfo `json:"system_voice"`
	VoiceCloning    []MinimaxVoiceInfo `json:"voice_cloning"`
	VoiceGeneration []MinimaxVoiceInfo `json:"voice_generation"`
}

// VolcEngineVoiceInfo 豆包音色信息
type VolcEngineVoiceInfo struct {
	VoiceType   string `json:"VoiceType"`
	Name        string `json:"Name"`
	Gender      string `json:"Gender"`
	Age         string `json:"Age"`
	Description string `json:"Description"`
	Language    string `json:"language"`
	Emotion     string `json:"emotion"`
}

// VolcEngineVoicesResp 豆包音色列表响应
type VolcEngineVoicesResp struct {
	Result struct {
		Total    int                   `json:"Total"`
		Speakers []VolcEngineVoiceInfo `json:"Speakers"`
	} `json:"Result"`
}

// VoicesResult 获取音色的统一返回结构
type VoicesResult struct {
	Provider         string                `json:"provider"`
	MinimaxVoices    []MinimaxVoiceInfo    `json:"minimax_voices,omitempty"`
	VolcEngineVoices []VolcEngineVoiceInfo `json:"volcengine_voices,omitempty"`
}
