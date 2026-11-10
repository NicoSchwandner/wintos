# add wsh to path, source dynamic script from wsh token
WAVETERM_WSHBINDIR={{.WSHBINDIR}}
export PATH="$WAVETERM_WSHBINDIR:$PATH"
source <(wsh token "$WAVETERM_SWAPTOKEN" zsh 2>/dev/null)
unset WAVETERM_SWAPTOKEN

# Source the original zshrc only if ZDOTDIR has not been changed
if [ "$ZDOTDIR" = "$WAVETERM_ZDOTDIR" ]; then
  [ -f ~/.zshrc ] && source ~/.zshrc
fi

if [[ ":$PATH:" != *":$WAVETERM_WSHBINDIR:"* ]]; then
  export PATH="$WAVETERM_WSHBINDIR:$PATH"
fi
unset WAVETERM_WSHBINDIR

if [[ -n ${_comps+x} ]]; then
  source <(wsh completion zsh)
fi

# fix history (macos)
if [[ "$HISTFILE" == "$WAVETERM_ZDOTDIR/.zsh_history" ]]; then
  HISTFILE="$HOME/.zsh_history"
fi

typeset -g _WAVETERM_SI_FIRSTPRECMD=1

# shell integration
# WintOS runs each pane's shell in a tmux of its own (socket wintos…), which drops these sequences;
# there they go through as tmux passthrough (allow-passthrough on in its config).
_waveterm_si_out() {
  if [[ "$TMUX" == */wintos* ]]; then
    local e=$'\033'
    printf '\033Ptmux;%s\033\\' "${1//$e/$e$e}"
  else
    printf '%s' "$1"
  fi
}

_waveterm_si_blocked() {
  [[ "$TMUX" == */wintos* ]] && return 1
  [[ -n "$TMUX" || -n "$STY" || "$TERM" == tmux* || "$TERM" == screen* ]]
}

_waveterm_si_urlencode() {
  if (( $+functions[omz_urlencode] )); then
    omz_urlencode "$1"
  else
    local s="$1"
    # Escape % first
    s=${s//\%/%25}
    # Common reserved characters in file paths
    s=${s//\ /%20}
    s=${s//\#/%23}
    s=${s//\?/%3F}
    s=${s//\&/%26}
    s=${s//\;/%3B}
    s=${s//\+/%2B}
    printf '%s' "$s"
  fi
}

_waveterm_si_compmode() {
  # fzf-based completion wins
  if typeset -f _fzf_tab_complete >/dev/null 2>&1 || typeset -f _fzf_complete >/dev/null 2>&1; then
    echo "fzf"
    return
  fi

  # Check zstyle menu setting
  local _menuval
  if zstyle -s ':completion:*' menu _menuval 2>/dev/null; then
    if [[ "$_menuval" == *select* ]]; then
      echo "menu-select"
    else
      echo "menu"
    fi
    return
  fi

  echo "standard"
}

_waveterm_si_osc7() {
  _waveterm_si_blocked && return
  local encoded_pwd=$(_waveterm_si_urlencode "$PWD")
  _waveterm_si_out "$(printf '\033]7;file://localhost%s\007' "$encoded_pwd")"  # OSC 7 - current directory
}

# WintOS runs each pane in a tmux of its own (socket wintos…), mouse off so a shell keeps the
# terminal's own selection and scrollback. Claude draws full screen and wants the wheel and clicks,
# which tmux passes on only with mouse on: on while a claude command runs, off at the next prompt.
typeset -g _WINTOS_MOUSE=0
_wintos_mouse() {
  [[ "$TMUX" == */wintos* ]] || return
  [[ "$1" == on ]] && (( _WINTOS_MOUSE )) && return
  [[ "$1" == off ]] && (( !_WINTOS_MOUSE )) && return
  tmux set-option -q mouse "$1" 2>/dev/null && _WINTOS_MOUSE=$([[ "$1" == on ]] && echo 1 || echo 0)
}
# Any word of the line, as WintOS's own lines start it after a cd (cd … && claude --resume …).
# A line that only mentions claude turns it on until its prompt: harmless.
_wintos_mouse_preexec() {
  local w
  for w in ${(z)1}; do
    [[ "${w:t}" == claude ]] && { _wintos_mouse on; return; }
  done
}
_wintos_mouse_precmd() { _wintos_mouse off; }

_waveterm_si_precmd() {
  local _waveterm_si_status=$?
  _waveterm_si_blocked && return
  # D;status for previous command (skip before first prompt)
  if (( !_WAVETERM_SI_FIRSTPRECMD )); then
    _waveterm_si_out "$(printf '\033]16162;D;{"exitcode":%d}\007' "$_waveterm_si_status")"
  else
    local uname_info=$(uname -smr 2>/dev/null)
    local omz=false
    local comp=$(_waveterm_si_compmode)
    [[ -n "$ZSH" && -r "$ZSH/oh-my-zsh.sh" ]] && omz=true
    _waveterm_si_out "$(printf '\033]16162;M;{"shell":"zsh","shellversion":"%s","uname":"%s","integration":true,"omz":%s,"comp":"%s"}\007' "$ZSH_VERSION" "$uname_info" "$omz" "$comp")"
    # OSC 7 only sent on first prompt - chpwd hook handles directory changes
    _waveterm_si_osc7
  fi
  _waveterm_si_out "$(printf '\033]16162;A\007')"
  _WAVETERM_SI_FIRSTPRECMD=0
}

_waveterm_si_preexec() {
  _waveterm_si_blocked && return
  local cmd="$1"
  local cmd_length=${#cmd}
  if [ "$cmd_length" -gt 8192 ]; then
    cmd=$(printf '# command too large (%d bytes)' "$cmd_length")
  fi
  local cmd64
  cmd64=$(printf '%s' "$cmd" | base64 2>/dev/null | tr -d '\n\r')
  if [ -n "$cmd64" ]; then
    _waveterm_si_out "$(printf '\033]16162;C;{"cmd64":"%s"}\007' "$cmd64")"
  else
    _waveterm_si_out "$(printf '\033]16162;C\007')"
  fi
}

typeset -g WAVETERM_SI_INPUTEMPTY=1

_waveterm_si_inputempty() {
  _waveterm_si_blocked && return
  
  local current_empty=1
  if [[ -n "$BUFFER" ]]; then
    current_empty=0
  fi
  
  if (( current_empty != WAVETERM_SI_INPUTEMPTY )); then
    WAVETERM_SI_INPUTEMPTY=$current_empty
    if (( current_empty )); then
      _waveterm_si_out "$(printf '\033]16162;I;{"inputempty":true}\007')"
    else
      _waveterm_si_out "$(printf '\033]16162;I;{"inputempty":false}\007')"
    fi
  fi
}

autoload -Uz add-zle-hook-widget 2>/dev/null
if (( $+functions[add-zle-hook-widget] )); then
  add-zle-hook-widget zle-line-init _waveterm_si_inputempty
  add-zle-hook-widget zle-line-pre-redraw _waveterm_si_inputempty
fi

autoload -U add-zsh-hook
add-zsh-hook precmd  _waveterm_si_precmd
add-zsh-hook preexec _waveterm_si_preexec
add-zsh-hook precmd  _wintos_mouse_precmd
add-zsh-hook preexec _wintos_mouse_preexec
add-zsh-hook chpwd   _waveterm_si_osc7