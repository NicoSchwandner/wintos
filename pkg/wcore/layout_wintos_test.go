package wcore

import (
	"context"
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

func newTestWorkspace(t *testing.T) (context.Context, *waveobj.Workspace) {
	t.Helper()
	ctx := initTestWStore(t)
	ws, err := CreateWorkspace(ctx, "w", "", "", false, false)
	if err != nil {
		t.Fatal(err)
	}
	return ctx, ws
}

// The Inbox holds what belongs to no project; every workspace has exactly one.
func TestEnsureInboxCreatesOnce(t *testing.T) {
	ctx, ws := newTestWorkspace(t)
	first, err := EnsureInbox(ctx, ws.OID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := EnsureInbox(ctx, ws.OID)
	if err != nil || second != first {
		t.Fatalf("second EnsureInbox = %q, %v; want %q", second, err, first)
	}
	ws, _ = GetWorkspace(ctx, ws.OID)
	inboxes := 0
	for _, id := range ws.TabIds {
		tab, _ := wstore.DBGet[*waveobj.Tab](ctx, id)
		if tab.Meta[MetaKey_WintosInbox] == true {
			inboxes++
			if len(tab.BlockIds) != 0 {
				t.Fatalf("new Inbox has blocks: %v", tab.BlockIds)
			}
		}
	}
	if inboxes != 1 {
		t.Fatalf("inboxes = %d, want 1", inboxes)
	}
}

func TestInboxCannotBeDeleted(t *testing.T) {
	ctx, ws := newTestWorkspace(t)
	inbox, _ := EnsureInbox(ctx, ws.OID)
	if _, err := DeleteTab(ctx, ws.OID, inbox, true); err == nil {
		t.Fatal("deleting the Inbox succeeded")
	}
	if tab, _ := wstore.DBGet[*waveobj.Tab](ctx, inbox); tab == nil {
		t.Fatal("the Inbox is gone")
	}
}

// With the Inbox always there, closing the last project lands on it; the window stays.
func TestClosingLastProjectActivatesInbox(t *testing.T) {
	ctx, ws := newTestWorkspace(t)
	inbox, _ := EnsureInbox(ctx, ws.OID)
	ws, _ = GetWorkspace(ctx, ws.OID)
	var active string
	var err error
	for _, id := range ws.TabIds {
		if id != inbox {
			if active, err = DeleteTab(ctx, ws.OID, id, true); err != nil {
				t.Fatal(err)
			}
		}
	}
	if active != inbox {
		t.Fatalf("active after closing the last project = %q, want the Inbox %q", active, inbox)
	}
}
