interface Props { message: string }

export default function ErrorBanner({ message }: Props) {
  return (
    <div className="mb-5 rounded-xl px-4 py-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20">
      {message}
    </div>
  )
}
