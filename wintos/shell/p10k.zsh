# WintOS palette for Powerlevel10k, loaded after ~/.p10k.zsh in WintOS shells only.
# p10k's rainbow style paints segments with ANSI numbers, which the WintOS terminal theme
# remaps to pastels; hex values keep the prompt in the design's warm neutrals, and colour
# only where it means something (moss = fine, apricot = changed, brick = failed).
[[ -n $WAVETERM_TABID ]] || return 0

() {
    local pill='#3c3836' text='#ebdbb2' secondary='#d5c4a1' muted='#a89984' faint='#504945'
    local apricot='#fe8019' brick='#fb4934' moss='#b8bb26'

    typeset -g POWERLEVEL9K_DIR_BACKGROUND=$pill
    typeset -g POWERLEVEL9K_DIR_FOREGROUND=$secondary
    typeset -g POWERLEVEL9K_DIR_SHORTENED_FOREGROUND=$muted
    typeset -g POWERLEVEL9K_DIR_ANCHOR_FOREGROUND=$text

    # The git formatter in ~/.p10k.zsh hardcodes black text (%0F) for a coloured pill, so the
    # git segment keeps a coloured background; conflicts use red text (%1F) on the dark pill.
    typeset -g POWERLEVEL9K_VCS_CLEAN_BACKGROUND=$moss
    typeset -g POWERLEVEL9K_VCS_{MODIFIED,UNTRACKED}_BACKGROUND=$apricot
    typeset -g POWERLEVEL9K_VCS_{CONFLICTED,LOADING}_BACKGROUND=$pill

    typeset -g POWERLEVEL9K_STATUS_{OK,OK_PIPE,ERROR,ERROR_SIGNAL,ERROR_PIPE}_BACKGROUND=$pill
    typeset -g POWERLEVEL9K_STATUS_{OK,OK_PIPE}_FOREGROUND=$moss
    typeset -g POWERLEVEL9K_STATUS_{ERROR,ERROR_SIGNAL,ERROR_PIPE}_FOREGROUND=$brick

    local seg
    for seg in COMMAND_EXECUTION_TIME BACKGROUND_JOBS NVM NODENV NODE_VERSION PYENV VIRTUALENV ANACONDA GOENV ASDF DIRENV CONTEXT TIME; do
        typeset -g POWERLEVEL9K_${seg}_BACKGROUND=$pill
        typeset -g POWERLEVEL9K_${seg}_FOREGROUND=$muted
    done

    typeset -g POWERLEVEL9K_PROMPT_CHAR_OK_{VIINS,VICMD,VIVIS,VIOWR}_FOREGROUND=$moss
    typeset -g POWERLEVEL9K_PROMPT_CHAR_ERROR_{VIINS,VICMD,VIVIS,VIOWR}_FOREGROUND=$brick
    typeset -g POWERLEVEL9K_MULTILINE_FIRST_PROMPT_GAP_FOREGROUND=$faint
    typeset -g POWERLEVEL9K_MULTILINE_{FIRST,NEWLINE,LAST}_PROMPT_PREFIX_FOREGROUND=$faint
}
