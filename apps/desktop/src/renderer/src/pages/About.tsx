function About(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2">
      <h1 className="text-2xl font-bold">About</h1>
      <p className="text-muted-foreground">
        Electron v{window.electron.process.versions.electron} · Chromium v
        {window.electron.process.versions.chrome} · Node v{window.electron.process.versions.node}
      </p>
    </div>
  )
}

export default About
