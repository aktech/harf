// Harf is a self-hosted chat interface for language models, with custom
// agents, in one binary.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/aktech/harf/internal/pi"
	"github.com/aktech/harf/internal/server"
	"github.com/aktech/harf/internal/store"
	"github.com/aktech/harf/web"
)

var version = "dev"

func main() {
	addr := flag.String("addr", envOr("HARF_ADDR", "127.0.0.1:8080"), "address to listen on (HARF_ADDR)")
	data := flag.String("data", envOr("HARF_DATA", defaultDataDir()), "directory for chats and agents (HARF_DATA)")
	piBin := flag.String("pi", envOr("HARF_PI", "pi"), "the pi executable (HARF_PI)")
	workspace := flag.String("workspace", os.Getenv("HARF_WORKSPACE"), "folder Pi's tools work in (HARF_WORKSPACE, default <data>/workspace)")
	defaultModel := flag.String("model", os.Getenv("HARF_DEFAULT_MODEL"), "model for new chats, as provider/id (HARF_DEFAULT_MODEL)")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	if err := run(*addr, *data, *piBin, *workspace, *defaultModel); err != nil {
		slog.Error("harf stopped", "err", err)
		os.Exit(1)
	}
}

func run(addr, data, piBin, workspace, defaultModel string) error {
	st, err := store.Open(data)
	if err != nil {
		return fmt.Errorf("open data directory %s: %w", data, err)
	}
	bin, err := exec.LookPath(piBin)
	if err != nil {
		return fmt.Errorf("find pi (install it from https://pi.dev, or set HARF_PI): %w", err)
	}
	if workspace == "" {
		workspace = filepath.Join(data, "workspace")
	}
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		return err
	}
	if workspace, err = filepath.Abs(workspace); err != nil {
		return err
	}
	agent := &pi.Runner{Bin: bin, Dir: workspace, SessionDir: filepath.Join(data, "sessions")}
	if err := agent.WriteExtensions(filepath.Join(data, "pi")); err != nil {
		return fmt.Errorf("write Harf's Pi extensions: %w", err)
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           server.New(st, agent, defaultModel, workspace, web.FS),
		ReadHeaderTimeout: 10 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()

	slog.Info("harf listening", "url", "http://"+addr, "data", data, "pi", bin, "workspace", workspace, "version", version)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func defaultDataDir() string {
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".harf")
	}
	return "data"
}
