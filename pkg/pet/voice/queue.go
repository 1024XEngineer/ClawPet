package voice

import (
	"errors"
	"sync"
)

var (
	ErrQueueEmpty = errors.New("audio queue is empty")
	ErrQueueFull  = errors.New("audio queue is full")
)

// AudioQueue 音频片段环形缓冲区
// 用于管理待播放的音频片段，按序号顺序播放
type AudioQueue struct {
	mu       sync.Mutex
	segments []*AudioSegment // 环形缓冲区
	capacity int             // 容量
	size     int             // 当前元素数量
	head     int             // 队头索引
	tail     int             // 队尾索引
}

// NewAudioQueue 创建指定容量的音频队列
func NewAudioQueue(capacity int) *AudioQueue {
	if capacity <= 0 {
		capacity = 100
	}
	return &AudioQueue{
		segments: make([]*AudioSegment, capacity),
		capacity: capacity,
		size:     0,
		head:     0,
		tail:     0,
	}
}

// Enqueue 入队，将片段添加到队尾
func (q *AudioQueue) Enqueue(seg *AudioSegment) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	if q.size >= q.capacity {
		return ErrQueueFull
	}

	q.segments[q.tail] = seg
	q.tail = (q.tail + 1) % q.capacity
	q.size++
	return nil
}

// Dequeue 出队，移除并返回队头元素
func (q *AudioQueue) Dequeue() (*AudioSegment, error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if q.size == 0 {
		return nil, ErrQueueEmpty
	}

	seg := q.segments[q.head]
	q.segments[q.head] = nil // 帮助 GC
	q.head = (q.head + 1) % q.capacity
	q.size--
	return seg, nil
}

// Front 返回队头元素（不移除）
func (q *AudioQueue) Front() (*AudioSegment, error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if q.size == 0 {
		return nil, ErrQueueEmpty
	}

	return q.segments[q.head], nil
}

// PeekNextReady 返回下一个已就绪但未发送的片段
func (q *AudioQueue) PeekNextReady() (*AudioSegment, error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if q.size == 0 {
		return nil, ErrQueueEmpty
	}

	return q.segments[q.head], nil
}

// MarkSent 标记队头元素已发送，并弹出
func (q *AudioQueue) MarkSent() (*AudioSegment, error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if q.size == 0 {
		return nil, ErrQueueEmpty
	}

	seg := q.segments[q.head]
	seg.Sent = true
	q.segments[q.head] = nil // 帮助 GC
	q.head = (q.head + 1) % q.capacity
	q.size--
	return seg, nil
}

// UpdateSegment 更新指定 seq 的片段（当合成完毕或收到音频数据时）
func (q *AudioQueue) UpdateSegment(seq int64, ready bool, audioData []byte, duration int, errMsg string) *AudioSegment {
	q.mu.Lock()
	defer q.mu.Unlock()

	for i := 0; i < q.size; i++ {
		idx := (q.head + i) % q.capacity
		seg := q.segments[idx]
		if seg != nil && seg.Seq == seq {
			seg.Ready = ready
			if audioData != nil {
				seg.AudioData = audioData
			}
			if duration > 0 {
				seg.Duration = duration
			}
			if errMsg != "" {
				seg.Error = errMsg
			}
			return seg
		}
	}
	return nil
}

// IsEmpty 判断队列是否为空
func (q *AudioQueue) IsEmpty() bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.size == 0
}

// Size 返回队列当前元素数量
func (q *AudioQueue) Size() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.size
}

// Clear 清空队列
func (q *AudioQueue) Clear() {
	q.mu.Lock()
	defer q.mu.Unlock()

	for i := 0; i < q.size; i++ {
		q.segments[(q.head+i)%q.capacity] = nil
	}
	q.size = 0
	q.head = 0
	q.tail = 0
}
