//go:build !unix

package store

import "os"

// lockStudio only opens the lock file where flock isn't available; running two guests
// on one studio there is not guarded.
func lockStudio(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
}
