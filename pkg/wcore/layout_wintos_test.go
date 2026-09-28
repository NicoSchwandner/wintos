package wcore

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
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

// A project is a tab; closing its last pane must leave the project open (and the window with it).
func TestDeletingLastBlockKeepsTheTab(t *testing.T) {
	ctx := initTestWStore(t)
	ws, err := CreateWorkspace(ctx, "w", "", "", false, false)
	if err != nil {
		t.Fatal(err)
	}
	tabId, err := CreateTab(ctx, ws.OID, "", true, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := createBlockObj(ctx, tabId, &waveobj.BlockDef{Meta: waveobj.MetaMapType{"view": "term"}}, nil); err != nil {
		t.Fatal(err)
	}
	tab, _ := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	for _, blockId := range tab.BlockIds {
		if err := DeleteBlock(ctx, blockId, true); err != nil {
			t.Fatal(err)
		}
	}
	tab, err = wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil || tab == nil {
		t.Fatalf("tab gone after closing its last block (err %v)", err)
	}
}

// Closing the last project leaves a blank placeholder tab instead of closing the window.
func TestClosingLastTabLeavesABlankTab(t *testing.T) {
	ctx := initTestWStore(t)
	ws, err := CreateWorkspace(ctx, "w", "", "", false, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := CreateTab(ctx, ws.OID, "", true, false); err != nil {
		t.Fatal(err)
	}
	ws, _ = GetWorkspace(ctx, ws.OID)
	var newActive string
	for _, tabId := range ws.TabIds {
		if newActive, err = DeleteTab(ctx, ws.OID, tabId, true); err != nil {
			t.Fatal(err)
		}
	}
	ws, _ = GetWorkspace(ctx, ws.OID)
	if len(ws.TabIds) != 1 || ws.TabIds[0] != newActive || ws.ActiveTabId != newActive {
		t.Fatalf("want one active blank tab, got tabs %v active %q (returned %q)", ws.TabIds, ws.ActiveTabId, newActive)
	}
	blank, _ := wstore.DBGet[*waveobj.Tab](ctx, newActive)
	if blank.Meta[MetaKey_WintosBlank] != true || len(blank.BlockIds) != 0 {
		t.Fatalf("placeholder tab = %+v", blank)
	}
}

// The placeholder only stands in until a project opens; the new tab replaces it.
func TestNewTabReplacesTheBlankTab(t *testing.T) {
	ctx := initTestWStore(t)
	ws, err := CreateWorkspace(ctx, "w", "", "", false, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, tabId := range ws.TabIds {
		if _, err := DeleteTab(ctx, ws.OID, tabId, true); err != nil {
			t.Fatal(err)
		}
	}
	newTab, err := CreateTab(ctx, ws.OID, "", true, false)
	if err != nil {
		t.Fatal(err)
	}
	ws, _ = GetWorkspace(ctx, ws.OID)
	if len(ws.TabIds) != 1 || ws.TabIds[0] != newTab {
		t.Fatalf("want only the new tab, got %v", ws.TabIds)
	}
}
