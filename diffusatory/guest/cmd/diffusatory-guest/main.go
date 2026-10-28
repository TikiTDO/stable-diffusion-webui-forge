// Command diffusatory-guest serves the Diffusatory socket. Until an engine slice is
// admitted it runs with no engine: every generate call is refused by capability, which
// is enough to build and test the page against the real protocol.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/api"
	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/rpc"
	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/store"
)

// noEngine advertises nothing, so Validate refuses every checkpoint by name.
type noEngine struct{}

func (noEngine) Capabilities() api.Capabilities {
	return api.Capabilities{ContractVersion: api.ContractVersion}
}

func (noEngine) Generate(context.Context, *api.GenerateRequest, func(rpc.Progress)) (*rpc.Result, error) {
	return nil, errors.New("no engine is loaded")
}

func main() {
	// Loopback by default: the socket has no authentication yet, so it must not be
	// reachable from the network until the access check lands.
	listen := flag.String("listen", "127.0.0.1:7871", "address to serve the socket on")
	studio := flag.String("studio", "studio", "directory holding projects, documents and takes")
	flag.Parse()

	st, err := store.Open(*studio)
	if err != nil {
		log.Fatalf("diffusatory-guest: open studio: %v", err)
	}
	defer st.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	mux := http.NewServeMux()
	mux.Handle("/socket", rpc.NewHub(ctx, noEngine{}, st))
	mux.Handle("/takes/", rpc.TakeFiles(*studio))
	srv := &http.Server{Addr: *listen, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	log.Printf("diffusatory-guest: serving ws://%s/socket with no engine", *listen)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
