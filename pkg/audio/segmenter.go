package audio

import (
	"strings"
)

type Segment struct {
	Text     string
	StartIdx int
	EndIdx   int
	IsFinal  bool
}

type TextSegmenter struct {
	MinChars    int
	MaxChars    int
	Punctuation []rune
}

func NewTextSegmenter() *TextSegmenter {
	return &TextSegmenter{
		MinChars:    10,
		MaxChars:    150,
		Punctuation: []rune{'。', '！', '？', '.', '!', '?', '，', ',', '；', ';'},
	}
}

func (s *TextSegmenter) SegmentText(
	text string,
	onSegment func(Segment) bool,
) {
	var buf strings.Builder
	lastBreak := 0

	for i, r := range text {
		buf.WriteRune(r)

		isPunct := false
		for _, p := range s.Punctuation {
			if r == p {
				isPunct = true
				break
			}
		}

		shouldEmit := false

		if isPunct {
			shouldEmit = buf.Len() >= s.MinChars
			lastBreak = buf.Len()
		} else if buf.Len() >= s.MaxChars {
			shouldEmit = true
			lastBreak = buf.Len()
		}

		if shouldEmit {
			seg := Segment{
				Text:     buf.String(),
				StartIdx: i - lastBreak + 1,
				EndIdx:   i + 1,
				IsFinal:  false,
			}
			if !onSegment(seg) {
				return
			}
			buf.Reset()
			lastBreak = 0
		}
	}

	if buf.Len() > 0 {
		onSegment(Segment{
			Text:     buf.String(),
			StartIdx: len(text) - buf.Len(),
			EndIdx:   len(text),
			IsFinal:  true,
		})
	}
}

func (s *TextSegmenter) SegmentBySentence(text string, onSegment func(Segment) bool) {
	s.MinChars = 5
	s.MaxChars = 200
	s.Punctuation = []rune{'。', '！', '？', '.', '!', '?'}
	s.SegmentText(text, onSegment)
}
