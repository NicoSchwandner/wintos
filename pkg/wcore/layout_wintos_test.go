package wcore

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func initScriptOf(t *testing.T) any {
	t.Helper()
	layout := GetNewTabLayout()
	if len(layout) != 1 || layout[0].BlockDef == nil {
		t.Fatalf("expected one block, got %+v", layout)
	}
	return layout[0].BlockDef.Meta[waveobj.MetaKey_CmdInitScript]
}

func TestNewTabStartsClaudeByDefault(t *testing.T) {
	t.Setenv("WINTOS_NEW_PROJECT_CMD", "")
	if got := initScriptOf(t); got != "claude" {
		t.Fatalf("init script = %v, want claude", got)
	}
}

func TestNewTabUsesConfiguredCommand(t *testing.T) {
	t.Setenv("WINTOS_NEW_PROJECT_CMD", "cd ~/work && claude")
	if got := initScriptOf(t); got != "cd ~/work && claude" {
		t.Fatalf("init script = %v", got)
	}
}

func TestNewTabCanOptOutOfClaude(t *testing.T) {
	t.Setenv("WINTOS_NEW_PROJECT_CMD", "none")
	if got := initScriptOf(t); got != nil {
		t.Fatalf("init script = %v, want none", got)
	}
}
