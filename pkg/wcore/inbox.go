package wcore

import (
	"context"
	"fmt"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// WintOS: the Inbox tabs are the ones that are not projects: PRs and On call, which belong to
// no project. Each workspace has exactly one of each, and neither is ever closed. The meta value
// says which list a tab holds; true is an Inbox from before the split, which held the PRs.
const MetaKey_WintosInbox = "wintos:inbox"

const (
	InboxPRs    = "prs"
	InboxOnCall = "oncall"
)

var inboxTabs = []struct{ kind, name string }{{InboxPRs, "PRs"}, {InboxOnCall, "On call"}}

func InboxKind(tab *waveobj.Tab) string {
	if tab == nil {
		return ""
	}
	switch v := tab.Meta[MetaKey_WintosInbox].(type) {
	case bool:
		if v {
			return InboxPRs
		}
	case string:
		return v
	}
	return ""
}

func IsInbox(tab *waveobj.Tab) bool {
	return InboxKind(tab) != ""
}

// Two windows loading at once would each find no Inbox and create one.
var ensureInboxLock sync.Mutex

// EnsureInbox makes sure both Inbox tabs exist (created not activated) and returns the PRs one.
func EnsureInbox(ctx context.Context, workspaceId string) (string, error) {
	ensureInboxLock.Lock()
	defer ensureInboxLock.Unlock()
	ws, err := GetWorkspace(ctx, workspaceId)
	if err != nil {
		return "", fmt.Errorf("workspace %s not found: %w", workspaceId, err)
	}
	found := map[string]string{}
	for _, tabId := range ws.TabIds {
		// An unreadable tab may be an Inbox; creating another would break "exactly one".
		tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
		if err != nil {
			return "", fmt.Errorf("error reading tab %s: %w", tabId, err)
		}
		k := InboxKind(tab)
		if k == "" || found[k] != "" {
			continue
		}
		found[k] = tabId
		// An Inbox from before the split becomes the PRs tab, by name and by meta.
		if tab.Meta[MetaKey_WintosInbox] == true {
			tab.Name, tab.Meta[MetaKey_WintosInbox] = "PRs", InboxPRs
			if err := wstore.DBUpdate(ctx, tab); err != nil {
				return "", fmt.Errorf("error renaming the old Inbox: %w", err)
			}
		}
	}
	for _, it := range inboxTabs {
		if found[it.kind] != "" {
			continue
		}
		tab, err := createTabObj(ctx, workspaceId, it.name, waveobj.MetaMapType{MetaKey_WintosInbox: it.kind})
		if err != nil {
			return "", fmt.Errorf("error creating the %s tab: %w", it.name, err)
		}
		found[it.kind] = tab.OID
	}
	return found[InboxPRs], nil
}
