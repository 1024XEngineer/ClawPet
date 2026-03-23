package main

import (
	"fmt"
	"io/fs"
	"log"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/ebitenutil"
)

const (
	screenWidth  = 120
	screenHeight = 120
)

type PetState int

const (
	Idle PetState = iota
	Eating
)

type Game struct {
	count int
	state PetState
}

func (g *Game) Update() error {
	g.count++

	// 修复：正确处理 Ebitengine 的 DroppedFiles (fs.FS)
	if fsys := ebiten.DroppedFiles(); fsys != nil {
		// 遍历拖入的文件系统
		fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() {
				g.handleFileDrop(path)
			}
			return nil
		})
	}

	if g.state != Idle && g.count%120 == 0 {
		g.state = Idle
	}
	return nil
}

func (g *Game) handleFileDrop(fileName string) {
	g.state = Eating
	fmt.Printf("【OpenClaw 预警】准备吃掉文件: %s\n", fileName)
	// 下一步在这里接入 OpenClaw API
}

func (g *Game) Draw(screen *ebiten.Image) {
	// 简单的视觉反馈
	if g.state == Eating {
		ebitenutil.DebugPrint(screen, "O_O NOM!")
	} else {
		ebitenutil.DebugPrint(screen, "(^..^) Meow~")
	}
}

func (g *Game) Layout(outsideWidth, outsideHeight int) (int, int) {
	return screenWidth, screenHeight
}

func main() {
	ebiten.SetWindowSize(screenWidth*2, screenHeight*2)
	ebiten.SetWindowTitle("ClawPet MVP")

	// 基础桌面属性
	ebiten.SetWindowDecorated(false)
	ebiten.SetWindowFloating(true)

	// 允许窗口透明 (注意：部分系统需要额外配置，MVP阶段先保功能)
	// ebiten.SetWindowMousePassthrough(false)

	if err := ebiten.RunGame(&Game{state: Idle}); err != nil {
		log.Fatal(err)
	}
}
