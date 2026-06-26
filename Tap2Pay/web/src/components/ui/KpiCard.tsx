interface Props {
  title: string
  value: string | number
  sub?: string
  accent?: boolean
}

export default function KpiCard({ title, value, sub, accent }: Props) {
  return (
    <div className="glass rounded-2xl p-5 flex flex-col gap-1">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-widest">{title}</div>
      <div className={`text-2xl font-bold ${accent ? 'text-electric' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}
