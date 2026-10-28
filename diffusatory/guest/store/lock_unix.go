//go:build unix

package store

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

// lockStudio takes an exclusive lock on path. The kernel releases it when the process
// exits, so a crash never leaves a studio locked.
func lockStudio(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, fmt.Errorf("studio is already open in another guest (%s)", path)
		}
		return nil, err
	}
	return f, nil
}
