import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Plotly from "plotly.js-dist-min"
import createPlotlyComponent from "react-plotly.js/factory"
const Plot = createPlotlyComponent(Plotly)
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

// Simple orbital helpers (km units)
const EARTH_RADIUS = 6371
const MOON_RADIUS = 1737
const EARTH_MOON_DISTANCE = 384400

function hohmannEllipsePoints(r1: number, r2: number, samples = 200) {
  const a = (r1 + r2) / 2
  const e = Math.abs(r2 - r1) / (r1 + r2)
  const points = [] as { x: number; y: number; z: number }[]
  for (let i = 0; i < samples; i++) {
    const theta = (i / (samples - 1)) * Math.PI // half ellipse
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(theta))
    points.push({ x: r * Math.cos(theta), y: r * Math.sin(theta), z: 0 })
  }
  return { a, e, points }
}

type DecisionLog = { timestamp: string; type: string; message: string; meta?: any }

type PlannerState = "idle" | "running" | "error" | "completed"

function normalizeDatasetUrl(u: string): string {
  const trimmed = (u || "").trim()
  const fileMatch = trimmed.match(/https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\//)
  if (fileMatch) return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`
  const openIdMatch = trimmed.match(/https?:\/\/drive\.google\.com\/open\?id=([^&]+)/)
  if (openIdMatch) return `https://drive.google.com/uc?export=download&id=${openIdMatch[1]}`
  if (trimmed.includes("drive.google.com")) {
    const idMatch = trimmed.match(/[?&]id=([^&]+)/)
    if (idMatch) return `https://drive.google.com/uc?export=download&id=${idMatch[1]}`
  }
  return trimmed
}

export default function AutonomousPlanner() {
  const [timestamp, setTimestamp] = useState<string>("2014-07-14T12:00")
  const [plannerState, setPlannerState] = useState<PlannerState>("idle")
  const [trajectoryPoints, setTrajectoryPoints] = useState<{ x: number; y: number; z: number }[]>([])
  const [metrics, setMetrics] = useState<{ deltaV?: number; transferTimeHours?: number; fuelEfficiency?: number } | null>(null)
  const [risk, setRisk] = useState<any>(null)
  const [logs, setLogs] = useState<DecisionLog[]>([])
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number; z: number } | null>(null)
  const rafRef = useRef<number | null>(null)

  const defaultDataset = "https://drive.google.com/file/d/1HZ-Ba0SUwWNY3hEpqMHjBmYP400f4bu-/view?usp=sharing"
  const [datasetUrl, setDatasetUrl] = useState<string>(() => localStorage.getItem("SPACE_WEATHER_DATA_URL") || defaultDataset)
  const [datasetJson, setDatasetJson] = useState<any>(null)
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1000)
  const [altTrajectoryPoints, setAltTrajectoryPoints] = useState<{ x: number; y: number; z: number }[] | null>(null)
  const [replanTriggered, setReplanTriggered] = useState<boolean>(false)
  const replanTimeoutRef = useRef<number | null>(null)
  const [riskTimeline, setRiskTimeline] = useState<number[] | null>(null)
  const riskTimelineRef = useRef<number[] | null>(null)
  const replanRef = useRef<boolean>(false)
  const loggedIdxRef = useRef<Set<number>>(new Set())

  const appendLog = useCallback((entry: DecisionLog) => {
    setLogs((prev) => [{ ...entry }, ...prev].slice(0, 200))
  }, [])

  useEffect(() => {
    riskTimelineRef.current = riskTimeline
  }, [riskTimeline])

  useEffect(() => {
    replanRef.current = replanTriggered
  }, [replanTriggered])

  const saveDatasetUrl = () => {
    localStorage.setItem("SPACE_WEATHER_DATA_URL", datasetUrl.trim())
    appendLog({ timestamp: new Date().toISOString(), type: "info", message: `Dataset set to ${datasetUrl.trim()}` })
  }

  async function loadLocalDataset(): Promise<any> {
    if (!datasetUrl.trim()) throw new Error("Dataset URL is required")
    const target = encodeURIComponent(datasetUrl.trim())
    const res = await fetch(`/api/proxy-json?url=${target}`, { cache: "no-store" })
    if (!res.ok) {
      const msg = await res.text().catch(() => "")
      throw new Error(`Dataset fetch failed (${res.status}) ${msg}`)
    }
    const data = await res.json()
    setDatasetJson(data)
    appendLog({ timestamp: new Date().toISOString(), type: "info", message: "Dataset loaded" })
    return data
  }

  function severityToRisk(sev: string): number {
    const s = (sev || "").toLowerCase()
    if (s.includes("critical")) return 0.9
    if (s.includes("high")) return 0.7
    if (s.includes("moderate") || s.includes("medium")) return 0.45
    if (s.includes("low")) return 0.2
    return 0.3
  }

  function computeRiskTimeline(start: Date, end: Date, events: any[], samples = 300): number[] {
    const span = end.getTime() - start.getTime()
    const sigma = 12 * 3600 * 1000
    const base = 0.1
    const sevAmp = (sev?: string) => severityToRisk(sev || "")
    const pts: number[] = []
    for (let i = 0; i < samples; i++) {
      const t = start.getTime() + (i / (samples - 1)) * span
      let v = base
      for (const e of events) {
        const et = new Date(e.date || e.timestamp || 0).getTime()
        const w = Math.exp(-Math.pow(t - et, 2) / (2 * sigma * sigma))
        v += sevAmp(e.severity) * w
      }
      pts.push(Math.min(0.98, v))
    }
    return pts
  }

  function buildLocalThreats(epochIso: string): any {
    const start = new Date(epochIso)
    const end = new Date(start.getTime() + 3 * 24 * 3600 * 1000)
    const data = datasetJson || {}
    const events: any[] = Array.isArray(data.major_events) ? data.major_events : []

    const inWindow = events.filter((e) => {
      const d = new Date(e.date || e.timestamp || 0)
      return d >= start && d <= end
    })
    const timeline = computeRiskTimeline(start, end, inWindow)
    setRiskTimeline(timeline)

    const riskItems = inWindow.map((e) => ({
      timestamp: new Date(e.date || e.timestamp).toISOString(),
      risk_score: severityToRisk(e.severity),
      event: e,
    }))
    const overallRisk = riskItems.length
      ? Math.min(0.95, riskItems.reduce((a, b) => a + b.risk_score, 0) / riskItems.length)
      : 0.25

    const solar_activity = {
      forecast_period: { start: start.toISOString(), end: end.toISOString() },
      forecast_data: [],
      high_risk_periods: riskItems,
      summary: inWindow.length ? ["Elevated risk from historical events in window"] : ["Low to moderate solar activity expected"],
    }

    const recommendations: string[] = []
    if (overallRisk > 0.6) recommendations.push("Delay burn window or increase shielding")
    if (overallRisk > 0.4) recommendations.push("Increase monitoring and consider contingency maneuvers")

    return {
      success: true,
      threats: {
        solar_activity,
        space_debris: { total_risk_score: overallRisk * 0.02 },
        radiation_exposure: { crew_safety: overallRisk > 0.6 ? "critical" : overallRisk > 0.4 ? "elevated_risk" : "safe" },
        communication_blackouts: [],
      },
      risk_assessment: {
        overall_risk: overallRisk,
      },
      recommendations,
      risk_over_time: timeline,
    }
  }

  // Animate spacecraft along the computed transfer over real time of the transfer
  const animateAlong = useCallback((points: { x: number; y: number; z: number }[], durationMs: number) => {
    if (!points.length || durationMs <= 0) {
      setCurrentPos(points[points.length - 1] || null)
      return
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const start = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs)
      const idx = Math.min(points.length - 1, Math.floor(p * (points.length - 1)))
      setCurrentPos(points[idx])

      const timeline = riskTimelineRef.current
      if (timeline && timeline.length > 1) {
        const tIdx = Math.min(timeline.length - 1, Math.floor(p * (timeline.length - 1)))
        const rv = timeline[tIdx]
        if (rv > 0.4 && !loggedIdxRef.current.has(tIdx)) {
          loggedIdxRef.current.add(tIdx)
          appendLog({ timestamp: new Date().toISOString(), type: rv > 0.6 ? "warn" : "info", message: rv > 0.6 ? "High risk segment detected ahead" : "Moderate risk segment ahead" })
        }
        if (rv > 0.6 && !replanRef.current) {
          replanRef.current = true
          setReplanTriggered(true)
          appendLog({ timestamp: new Date().toISOString(), type: "warn", message: "Hazard high. Switching to replanned trajectory." })
          const remaining = durationMs * (1 - p)
          const base = hohmannEllipsePoints(EARTH_RADIUS + 200, EARTH_MOON_DISTANCE, 1500).points
          const alt = base.map((pt, i) => ({
            x: pt.x * 0.98,
            y: pt.y * 0.98,
            z: 0.05 * Math.sin((i / Math.max(1, base.length - 1)) * Math.PI * 2) * (EARTH_MOON_DISTANCE * 0.02),
          }))
          setAltTrajectoryPoints(alt)
          rafRef.current = null
          return animateAlong(alt, remaining)
        }
      }

      if (p < 1) rafRef.current = requestAnimationFrame(step)
      else rafRef.current = null
    }
    rafRef.current = requestAnimationFrame(step)
  }, [appendLog])

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (replanTimeoutRef.current) window.clearTimeout(replanTimeoutRef.current)
    }
  }, [])

  const runPipeline = useCallback(async () => {
    try {
      setPlannerState("running")
      setLogs([])
      setCurrentPos(null)
      setAltTrajectoryPoints(null)
      setReplanTriggered(false)
      replanRef.current = false
      loggedIdxRef.current = new Set()
      if (replanTimeoutRef.current) window.clearTimeout(replanTimeoutRef.current)

      const r1 = EARTH_RADIUS + 200
      const r2 = EARTH_MOON_DISTANCE
      const nowIso = new Date(timestamp).toISOString()

      const mu = 398600
      const a = (r1 + r2) / 2
      const v1 = Math.sqrt(mu / r1)
      const v2 = Math.sqrt(mu / r2)
      const vPer = Math.sqrt(mu * (2 / r1 - 1 / a))
      const vApo = Math.sqrt(mu * (2 / r2 - 1 / a))
      const deltaV = Math.abs(vPer - v1) + Math.abs(v2 - vApo)
      const tSec = Math.PI * Math.sqrt(Math.pow(a, 3) / mu)

      const { points } = hohmannEllipsePoints(r1, r2, 1500)
      setTrajectoryPoints(points)
      setMetrics({ deltaV, transferTimeHours: tSec / 3600, fuelEfficiency: Math.max(0, 100 - deltaV / 10) })
      const durationMs = (tSec * 1000) / Math.max(1, speedMultiplier)
      animateAlong(points, durationMs)

      if (!datasetJson) await loadLocalDataset()
      appendLog({ timestamp: nowIso, type: "info", message: "Analyzing threats (local)" })
      const thJson = buildLocalThreats(nowIso)
      setRisk(thJson)

      const riskVal = thJson?.risk_assessment?.overall_risk || 0
      const decision = riskVal > 0.6 ? "delay_orbit_insertion" : "proceed_with_caution"
      appendLog({ timestamp: new Date().toISOString(), type: "decision", message: `Local decision: ${decision}`, meta: { risk: riskVal } })

      setPlannerState("completed")
    } catch (err: any) {
      setPlannerState("error")
      appendLog({ timestamp: new Date().toISOString(), type: "error", message: err?.message || "Pipeline failed" })
    }
  }, [appendLog, timestamp, datasetUrl, datasetJson, animateAlong, speedMultiplier])

  const plotData = useMemo(() => {
    const earthOrbit = {
      x: Array.from({ length: 200 }, (_, i) => (EARTH_RADIUS + 200) * Math.cos((i / 199) * 2 * Math.PI)),
      y: Array.from({ length: 200 }, (_, i) => (EARTH_RADIUS + 200) * Math.sin((i / 199) * 2 * Math.PI)),
      z: Array(200).fill(0),
      type: "scatter3d" as const,
      mode: "lines",
      name: "LEO",
      line: { color: "#6b7280" },
    }
    const moonOrbit = {
      x: Array.from({ length: 200 }, (_, i) => EARTH_MOON_DISTANCE * Math.cos((i / 199) * 2 * Math.PI)),
      y: Array.from({ length: 200 }, (_, i) => EARTH_MOON_DISTANCE * Math.sin((i / 199) * 2 * Math.PI)),
      z: Array(200).fill(0),
      type: "scatter3d" as const,
      mode: "lines",
      name: "Moon Orbit",
      line: { color: "#94a3b8" },
    }
    const transfer = trajectoryPoints.length
      ? {
          x: trajectoryPoints.map((p) => p.x),
          y: trajectoryPoints.map((p) => p.y),
          z: trajectoryPoints.map((p) => p.z),
          type: "scatter3d" as const,
          mode: "lines+markers",
          name: "Transfer",
          line: { color: "#f97316", width: 4 },
          marker: { size: 2, color: "#f59e0b" },
        }
      : null
    const replan = altTrajectoryPoints && altTrajectoryPoints.length
      ? {
          x: altTrajectoryPoints.map((p) => p.x),
          y: altTrajectoryPoints.map((p) => p.y),
          z: altTrajectoryPoints.map((p) => p.z),
          type: "scatter3d" as const,
          mode: "lines",
          name: "Replan",
          line: { color: "#60a5fa", width: 3, dash: "dot" },
        }
      : null
    const spacecraft = currentPos
      ? {
          x: [currentPos.x],
          y: [currentPos.y],
          z: [currentPos.z],
          type: "scatter3d" as const,
          mode: "markers",
          name: "Spacecraft",
          marker: { size: 6, color: "#22c55e", line: { color: "#065f46", width: 1 } },
        }
      : null
    return [earthOrbit, moonOrbit, transfer, replan, spacecraft].filter(Boolean)
  }, [trajectoryPoints, altTrajectoryPoints, currentPos])

  const plotLayout = {
    autosize: true,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    scene: {
      xaxis: { title: "km", gridcolor: "#334155", zerolinecolor: "#334155", color: "#e5e7eb" },
      yaxis: { title: "km", gridcolor: "#334155", zerolinecolor: "#334155", color: "#e5e7eb" },
      zaxis: { title: "km", gridcolor: "#334155", zerolinecolor: "#334155", color: "#e5e7eb" },
      aspectmode: "data" as const,
    },
    margin: { l: 0, r: 0, t: 0, b: 0 },
    showlegend: true,
    legend: { font: { color: "#e5e7eb" } },
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <Card className="bg-white/5 backdrop-blur-sm border-white/10 xl:col-span-2">
        <CardContent className="p-4 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-mission-orange/20 text-mission-orange border-mission-orange">Autonomous Planner</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="dataset" className="text-white/80">Dataset</Label>
                <Input id="dataset" placeholder="https://drive.google.com/file/d/1HZ-Ba0SUwWNY3hEpqMHjBmYP400f4bu-/view?usp=sharing" value={datasetUrl} onChange={(e) => setDatasetUrl(e.target.value)} className="w-64 bg-white/10 border-white/20 text-white placeholder:text-white/50" />
                <Button size="sm" variant="outline" className="border-white/30 text-white hover:bg-white/10" onClick={saveDatasetUrl}>Save</Button>
                <Button size="sm" className="bg-mission-orange hover:bg-mission-orange/90 text-white" onClick={() => loadLocalDataset()}>Load</Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <Label htmlFor="timestamp" className="text-white/80">Epoch (2012-2018)</Label>
              <Input
                id="timestamp"
                type="datetime-local"
                min="2012-01-01T00:00"
                max="2018-12-31T23:59"
                value={timestamp}
                onChange={(e) => setTimestamp(e.target.value)}
                className="bg-white/10 border-white/20 text-white"
              />
            </div>
            <div className="flex flex-col gap-2">
              <div>
                <Label htmlFor="speed" className="text-white/80">Time Speed</Label>
                <div className="flex items-center gap-2">
                  <Input id="speed" type="range" min={1} max={20000} step={1} value={speedMultiplier} onChange={(e) => setSpeedMultiplier(Number(e.target.value))} className="w-40 bg-white/10 border-white/20" />
                  <div className="text-white/80 w-14 text-sm text-right">{speedMultiplier.toFixed(0)}x</div>
                </div>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={runPipeline}
                  className="w-full bg-mission-orange hover:bg-mission-orange/90 text-white"
                  disabled={plannerState === "running"}
                >
                  {plannerState === "running" ? "Planning…" : "Start Autonomous Planning"}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-white/80">
              <div className="p-3 rounded-md bg-white/5 border border-white/10">
                <div className="text-xs text-white/60">ΔV (m/s)</div>
                <div className="text-lg font-semibold">{metrics?.deltaV ? metrics.deltaV.toFixed(0) : "—"}</div>
              </div>
              <div className="p-3 rounded-md bg-white/5 border border-white/10">
                <div className="text-xs text-white/60">Time (h)</div>
                <div className="text-lg font-semibold">{metrics?.transferTimeHours ? metrics.transferTimeHours.toFixed(1) : "—"}</div>
              </div>
              <div className="p-3 rounded-md bg-white/5 border border-white/10">
                <div className="text-xs text-white/60">Fuel (%)</div>
                <div className="text-lg font-semibold">{metrics?.fuelEfficiency ? metrics.fuelEfficiency.toFixed(0) : "—"}</div>
              </div>
            </div>
          </div>

          <div className="h-[480px] rounded-md overflow-hidden border border-white/10">
            <Plot data={plotData as any} layout={plotLayout as any} style={{ width: "100%", height: "100%" }} config={{ displayModeBar: true }} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="bg-white/5 backdrop-blur-sm border-white/10">
          <CardContent className="p-4 md:p-6">
            <h3 className="text-white font-semibold mb-3">Real-time Decision Logs</h3>
            <div className="h-[540px] overflow-auto space-y-3 pr-2">
              {logs.length === 0 && <div className="text-white/60">No logs yet. Start planning to see updates.</div>}
              {logs.map((l, idx) => (
                <div key={idx} className="p-3 rounded-md border border-white/10 bg-white/5">
                  <div className="text-xs text-white/60">{new Date(l.timestamp).toLocaleString()}</div>
                  <div className="text-white">[{l.type}] {l.message}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 backdrop-blur-sm border-white/10">
          <CardContent className="p-4 md:p-6">
            <h3 className="text-white font-semibold mb-3">Risk Assessment</h3>
            <pre className="text-xs text-white/80 whitespace-pre-wrap break-words max-h-[220px] overflow-auto">{risk ? JSON.stringify(risk, null, 2) : "No analysis yet."}</pre>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
