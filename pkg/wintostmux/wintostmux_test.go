package wintostmux

import (
	"os"
	"os/exec"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// The config goes to a folder of the test's own, never a Wave data folder.
func TestMain(m *testing.M) {
	dir, _ := os.MkdirTemp("", "wintostmux")
	wavebase.DataHome_VarCache = dir
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

func TestWrapAttachesOrCreatesTheSessionOfThePane(t *testing.T) {
	t.Setenv("WINTOS_INSTANCE", "gotest")
	if bin, _ := wintosTmux(); bin == "" {
		t.Skip("no tmux")
	}
	shell := exec.Command("/bin/zsh", "-l", "-i")
	shell.Env = []string{"WAVETERM_BLOCKID=b1", "TMUX=/tmp/outer,1,0", "ZDOTDIR=/z"}
	shell.Dir = "/tmp"
	w := Wrap(shell, "b1", 24, 80)
	args := strings.Join(w.Args, " ")
	for _, want := range []string{"-L wintos-gotest", "new-session -A -s w-b1", "-x 80 -y 24", "-c /tmp", "-e WAVETERM_BLOCKID=b1", "-e ZDOTDIR=/z", "-- /bin/zsh -l -i"} {
		if !strings.Contains(args, want) {
			t.Errorf("args %q lack %q", args, want)
		}
	}
	// Started from inside tmux, the client would refuse to nest.
	if strings.Contains(args, "TMUX=") || slices.ContainsFunc(w.Env, func(kv string) bool { return strings.HasPrefix(kv, "TMUX=") }) {
		t.Errorf("TMUX leaked into %q", args)
	}
}

func TestSweepEndsOnlyTheSessionsWhosePaneIsGone(t *testing.T) {
	t.Setenv("WINTOS_INSTANCE", "gotest")
	bin, conf := wintosTmux()
	if bin == "" {
		t.Skip("no tmux")
	}
	tm := func(args ...string) (string, error) {
		out, err := exec.Command(bin, append([]string{"-L", WintosTmuxSocket(), "-f", conf}, args...)...).CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}
	defer tm("kill-server")
	for _, id := range []string{"kept", "gone"} {
		if out, err := tm("new-session", "-d", "-s", WintosTmuxSession(id), "sleep 60"); err != nil {
			t.Fatalf("new-session %s: %v %s", id, err, out)
		}
	}
	Sweep(func(blockId string) bool { return blockId == "kept" })
	out, _ := tm("list-sessions", "-F", "#{session_name}")
	if out != "w-kept" {
		t.Errorf("sessions after the sweep: %q, want only w-kept", out)
	}
	Kill("kept")
	if out, _ := tm("list-sessions", "-F", "#{session_name}"); out != "" && !strings.Contains(out, "no server") {
		t.Errorf("sessions after Kill: %q", out)
	}
}
