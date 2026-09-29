package wcore

import (
	"context"
	"fmt"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// WintOS: the Inbox is the one tab that is not a project. It holds the PR queue and on call,
// which belong to no project, so there is exactly one per workspace and it is never closed.
const MetaKey_WintosInbox = "wintos:inbox"

func IsInbox(tab *waveobj.Tab) bool {
	return tab != nil && tab.Meta[MetaKey_WintosInbox] == true
}

// Two windows loading at once would each find no Inbox and create one.
var ensureInboxLock sync.Mutex

// EnsureInbox returns the workspace's Inbox tab, creating it (not activated) when missing.
func EnsureInbox(ctx context.Context, workspaceId string) (string, error) {
	ensureInboxLock.Lock()
	defer ensureInboxLock.Unlock()
	ws, err := GetWorkspace(ctx, workspaceId)
	if err != nil {
		return "", fmt.Errorf("workspace %s not found: %w", workspaceId, err)
	}
	for _, tabId := range ws.TabIds {
		// An unreadable tab may be the Inbox; creating another would break "exactly one".
		tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
		if err != nil {
			return "", fmt.Errorf("error reading tab %s: %w", tabId, err)
		}
		if IsInbox(tab) {
			return tabId, nil
		}
	}
	tab, err := createTabObj(ctx, workspaceId, "Inbox", waveobj.MetaMapType{MetaKey_WintosInbox: true})
	if err != nil {
		return "", fmt.Errorf("error creating the Inbox: %w", err)
	}
	return tab.OID, nil
}
