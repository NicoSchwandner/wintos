// WintOS: a local shell runs inside a tmux session of its own, named after its pane, so a Claude
// session and the Monitors it runs outlive WintOS quitting, crashing or updating (⌥⌘U). The pane
// is only a tmux client: started again after a restart it attaches to the session still running.
// Closing the pane ends the session (Kill), as closing a pane always ended its shell.
//
// tmux stays out of sight: no status bar, no prefix key, no mouse handling and no alternate
// screen, so scrolling, selection and every key stay the terminal's (wintosTmuxConf). A machine
// restart still ends every session; the pane then starts a fresh shell, which runs its init
// script (`claude --resume …`) as before.

package wintostmux

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const wintosTmuxConf = `# Written by WintOS (pkg/shellexec/wintostmux.go) on every start; edits here are lost.
set -g status off
set -g prefix None
set -g prefix2 None
unbind-key -a -T prefix
unbind-key -a -T root
set -s escape-time 0
set -g mouse off
set -g history-limit 2000
set -g default-terminal "xterm-256color"
set -as terminal-features ",xterm*:RGB:extkeys:clipboard:focus:title"
# No alternate screen: what scrolls off goes to the terminal's own scrollback.
set -as terminal-overrides ",xterm*:smcup@:rmcup@"
set -s extended-keys on
set -s set-clipboard on
set -g focus-events on
set -g allow-passthrough on
set -g set-titles on
set -g set-titles-string "#T"
set -g window-size latest
set -g aggressive-resize on
set -g destroy-unattached off
set -g remain-on-exit off
set -g detach-on-destroy on
`

var (
	tmuxOnce sync.Once
	tmuxBin  string
	tmuxConf string
)

// The tmux binary, or "" when there is none or WINTOS_TMUX=0: then shells run as Wave runs them.
func wintosTmux() (bin string, conf string) {
	tmuxOnce.Do(func() {
		if os.Getenv("WINTOS_TMUX") == "0" {
			return
		}
		bin, _ = exec.LookPath("tmux")
		for _, p := range []string{"/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"} {
			if bin != "" {
				break
			}
			if _, err := os.Stat(p); err == nil {
				bin = p
			}
		}
		if bin == "" {
			return
		}
		conf = filepath.Join(wavebase.GetWaveDataDir(), "wintos-tmux.conf")
		if err := os.WriteFile(conf, []byte(wintosTmuxConf), 0644); err != nil {
			log.Printf("wintos tmux: can't write %s, shells run without tmux: %v", conf, err)
			bin = ""
			return
		}
		tmuxBin, tmuxConf = bin, conf
	})
	return tmuxBin, tmuxConf
}

var instanceChars = regexp.MustCompile(`[^A-Za-z0-9_-]`)

// Each WintOS instance has a tmux server of its own: the dev instance never touches yours.
func WintosTmuxSocket() string {
	if inst := os.Getenv("WINTOS_INSTANCE"); inst != "" {
		return "wintos-" + instanceChars.ReplaceAllString(inst, "")
	}
	return "wintos"
}

func WintosTmuxSession(blockId string) string { return "w-" + blockId }

// The pane's shell command, run inside its tmux session: attached when the session already runs,
// else created with the shell's command and its whole environment (the pane's ids, the swap
// token its rc file reads, ZDOTDIR).
func Wrap(ecmd *exec.Cmd, blockId string, rows, cols int) *exec.Cmd {
	bin, conf := wintosTmux()
	if bin == "" || blockId == "" {
		return ecmd
	}
	args := []string{"-L", WintosTmuxSocket(), "-f", conf, "new-session", "-A", "-s", WintosTmuxSession(blockId), "-x", fmt.Sprint(cols), "-y", fmt.Sprint(rows)}
	if ecmd.Dir != "" {
		args = append(args, "-c", ecmd.Dir)
	}
	var clientEnv []string
	for _, kv := range ecmd.Env {
		// Started from inside tmux, the client would refuse to nest.
		if strings.HasPrefix(kv, "TMUX=") || strings.HasPrefix(kv, "TMUX_PANE=") {
			continue
		}
		clientEnv = append(clientEnv, kv)
		args = append(args, "-e", kv)
	}
	args = append(args, "-e", "COLORTERM=truecolor", "--")
	args = append(args, ecmd.Args...)
	wrapped := exec.Command(bin, args...)
	wrapped.Env = clientEnv
	wrapped.Dir = ecmd.Dir
	return wrapped
}

// Kill ends a pane's tmux session: the pane was closed, or its terminal restarted (⌥⌘R).
func Kill(blockId string) {
	bin, _ := wintosTmux()
	if bin == "" || blockId == "" {
		return
	}
	// "=" matches the name exactly, never a session whose name merely starts with it.
	if out, err := exec.Command(bin, "-L", WintosTmuxSocket(), "kill-session", "-t", "="+WintosTmuxSession(blockId)).CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if !strings.Contains(msg, "can't find session") && !strings.Contains(msg, "no server running") && !strings.Contains(msg, "error connecting") {
			log.Printf("wintos tmux: kill-session %s: %v %s", blockId, err, msg)
		}
	}
}

// Sweep ends the sessions whose pane no longer exists: a pane closed while the kill could not run
// (a crash mid-close). Closing it was the developer's own act; the sweep only finishes it.
// Sessions of panes that exist are left alone, whatever they run.
func Sweep(paneExists func(blockId string) bool) {
	bin, _ := wintosTmux()
	if bin == "" {
		return
	}
	out, err := exec.Command(bin, "-L", WintosTmuxSocket(), "list-sessions", "-F", "#{session_name}").Output()
	if err != nil {
		return // no server yet: nothing to sweep
	}
	for _, name := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		blockId, ok := strings.CutPrefix(name, "w-")
		if !ok || paneExists(blockId) {
			continue
		}
		log.Printf("wintos tmux: ending session %s, its pane is gone", name)
		Kill(blockId)
	}
}
