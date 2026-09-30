import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { HugeiconsIcon } from '@hugeicons/react'
import { Csv01Icon, File01Icon, SourceCodeIcon } from '@hugeicons/core-free-icons'
import { ApiError, friendlyErrorMessage, transcribeAudio, type DraftKind } from '@/lib/api'
import { INTENT_OPTIONS, requestForIntent, type ChatIntent } from '@/lib/chat-intent'
import { attachmentLimitError } from '@/lib/attachment-limits.mjs'
import type { ExecutionMode } from '@/lib/modes'

// --- Utility Function & Radix Primitives ---
type ClassValue = string | number | boolean | null | undefined
function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(' ')
}

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & { showArrow?: boolean }
>(({ className, sideOffset = 4, showArrow = false, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'relative z-50 max-w-[280px] rounded-md bg-popover text-popover-foreground px-1.5 py-1 text-xs animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 border border-border shadow-md',
        className
      )}
      {...props}
    >
      {props.children}
      {showArrow && <TooltipPrimitive.Arrow className="-my-px fill-popover" />}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-64 rounded-xl bg-[#FAF9F6] dark:bg-[#252523] border border-[#E5E3DF] dark:border-[#2C2C2A] p-2 text-[#2E2E2D] dark:text-[#EAE8E3] shadow-md outline-none animate-in data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

const Dialog = DialogPrimitive.Root
const DialogPortal = DialogPrimitive.Portal
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-[90vw] md:max-w-[800px] translate-x-[-50%] translate-y-[-50%] gap-4 border-none bg-transparent p-0 shadow-none duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className
      )}
      {...props}
    >
      <div className="relative bg-card dark:bg-[#303030] rounded-[28px] overflow-hidden shadow-2xl p-1">
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 z-10 rounded-full bg-background/50 dark:bg-[#303030] p-1 hover:bg-accent dark:hover:bg-[#515151] transition-all cursor-pointer">
          <XIcon className="h-5 w-5 text-muted-foreground dark:text-gray-200 hover:text-foreground dark:hover:text-white" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </div>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

// --- SVG Icon Components ---
const PlusIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M12 5V19"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5 12H19"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
const SendIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="M12 5.25L12 18.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path
      d="M18.75 12L12 5.25L5.25 12"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
)

const XIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)
const ImageIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
)
const MicIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
)

export interface FileAttachment {
  kind: 'file'
  id: string
  name: string
  content: string
  size: number
}

export interface ImageAttachment {
  kind: 'image'
  id: string
  name: string
  dataUrl: string
}

export type Attachment = FileAttachment | ImageAttachment

// Extensions read as plain text and inlined into the prompt -- covers common
// docs/notes/config/source files.
const TEXT_FILE_EXTENSIONS = [
  '.md',
  '.txt',
  '.csv',
  '.json',
  '.log',
  '.yaml',
  '.yml',
  '.py',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.html',
  '.css',
  '.sql',
  '.java',
  '.c',
  '.cpp',
  '.go',
  '.rs',
  '.sh'
]

const CODE_FILE_EXTENSIONS = [
  '.py',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.html',
  '.css',
  '.sql',
  '.java',
  '.c',
  '.cpp',
  '.go',
  '.rs',
  '.sh',
  '.json',
  '.yaml',
  '.yml'
]

function isTextFile(file: File): boolean {
  const lower = file.name.toLowerCase()
  return TEXT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext)) || file.type.startsWith('text/')
}

/** Small icon per file type for the attachment block -- images get a real
 * thumbnail instead (see the render of `kind === 'image'` attachments).
 * Exported so ChatArea can render the same icon for a sent message's blocks. */
export function fileIcon(name: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.csv')) return Csv01Icon
  if (CODE_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return SourceCodeIcon
  return File01Icon
}

interface PromptBoxProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  onSubmitPrompt?: (
    text: string,
    selectedTool: string | null,
    attachments: Attachment[],
    mode: ExecutionMode,
    draftKind: DraftKind
  ) => void
  /** A response is currently being generated -- typing stays enabled, but the
   * send button becomes a Stop button instead of being disabled outright. */
  isBusy?: boolean
  onStop?: () => void
  modelPicker?: React.ReactNode
  canSend?: boolean
  toolCallsAvailable?: boolean
  intent?: ChatIntent
  onIntentChange?: (intent: ChatIntent) => void
  draftKind?: DraftKind
  onDraftKindChange?: (kind: DraftKind) => void
}

// --- The Final, Self-Contained PromptBox Component ---
export const PromptBox = React.forwardRef<HTMLTextAreaElement, PromptBoxProps>(
  ({ className, onSubmitPrompt, isBusy, onStop, modelPicker, canSend = true, toolCallsAvailable = false,
    intent: intentProp, onIntentChange, draftKind: draftKindProp, onDraftKindChange, ...props }, ref) => {
    const internalTextareaRef = React.useRef<HTMLTextAreaElement>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const pendingTextFiles = React.useRef<File[]>([])
    const [value, setValue] = React.useState('')
    const [attachments, setAttachments] = React.useState<Attachment[]>([])
    const [internalIntent, setInternalIntent] = React.useState<ChatIntent>('auto')
    const [internalDraftKind, setInternalDraftKind] = React.useState<DraftKind>('research_brief')
    const intent = intentProp ?? internalIntent
    const draftKind = draftKindProp ?? internalDraftKind
    const { tool: selectedTool, mode } = requestForIntent(intent)
    const setIntent = (next: ChatIntent): void => {
      if (intentProp === undefined) setInternalIntent(next)
      onIntentChange?.(next)
    }
    const setDraftKind = (next: DraftKind): void => {
      if (draftKindProp === undefined) setInternalDraftKind(next)
      onDraftKindChange?.(next)
    }
    const [isPopoverOpen, setIsPopoverOpen] = React.useState(false)
    const [expandedImage, setExpandedImage] = React.useState<string | null>(null)
    const [isRecording, setIsRecording] = React.useState(false)
    const [isTranscribing, setIsTranscribing] = React.useState(false)
    const [voiceError, setVoiceError] = React.useState<string | null>(null)
    const [fileError, setFileError] = React.useState<string | null>(null)
    const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
    const audioChunksRef = React.useRef<Blob[]>([])
    const baseValueRef = React.useRef('')

    React.useImperativeHandle(ref, () => internalTextareaRef.current!, [])

    React.useEffect(() => {
      return () => {
        mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop())
      }
    }, [])

    const handleTranscription = async (blob: Blob): Promise<void> => {
      setIsTranscribing(true)
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve((reader.result as string).split(',')[1] || '')
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        const mime = blob.type.split(';')[0] || 'audio/webm'
        const { text } = await transcribeAudio(base64, mime)
        if (text) {
          const base = baseValueRef.current
          const spacer = base && !base.endsWith(' ') ? ' ' : ''
          setValue(base + spacer + text)
        }
      } catch (err) {
        setVoiceError(
          err instanceof ApiError && err.status === 400
            ? 'Add a Groq API key in Profile > Advanced to enable voice typing.'
            : friendlyErrorMessage(err, 'Voice typing failed. Please try again.')
        )
      } finally {
        setIsTranscribing(false)
      }
    }

    const handleMicClick = async (): Promise<void> => {
      if (isRecording) {
        mediaRecorderRef.current?.stop()
        return
      }

      setVoiceError(null)
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        setVoiceError('Microphone access was denied.')
        return
      }

      baseValueRef.current = value
      audioChunksRef.current = []

      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setIsRecording(false)
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size > 0) handleTranscription(blob)
      }

      mediaRecorderRef.current = recorder
      setIsRecording(true)
      recorder.start()
    }

    React.useLayoutEffect(() => {
      const textarea = internalTextareaRef.current
      if (textarea) {
        textarea.style.height = 'auto'
        const newHeight = Math.min(textarea.scrollHeight, 200)
        textarea.style.height = `${newHeight}px`
      }
    }, [value])

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value)
      if (props.onChange) props.onChange(e)
    }

    const handlePlusClick = () => {
      fileInputRef.current?.click()
    }

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || [])
      const selected = files.filter((file) => !file.type.startsWith('image/') && isTextFile(file))
      const error = attachmentLimitError(selected, [
        ...attachments.filter((att): att is FileAttachment => att.kind === 'file'),
        ...pendingTextFiles.current
      ])
      setFileError(error)
      event.target.value = ''
      if (error) return
      for (const file of files) {
        const id = crypto.randomUUID()
        if (file.type.startsWith('image/')) {
          const reader = new FileReader()
          reader.onloadend = () => {
            setAttachments((prev) => [
              ...prev,
              { kind: 'image', id, name: file.name, dataUrl: reader.result as string }
            ])
          }
          reader.readAsDataURL(file)
        } else if (isTextFile(file)) {
          pendingTextFiles.current.push(file)
          const reader = new FileReader()
          reader.onloadend = () => {
            pendingTextFiles.current = pendingTextFiles.current.filter((pending) => pending !== file)
            if (typeof reader.result !== 'string') {
              setFileError(`Could not read ${file.name}.`)
              return
            }
            const content = reader.result
            setAttachments((prev) => [
              ...prev,
              { kind: 'file', id, name: file.name, content, size: file.size }
            ])
          }
          reader.readAsText(file)
        }
      }
    }

    const handleRemoveAttachment = (id: string) => {
      setAttachments((prev) => prev.filter((a) => a.id !== id))
    }

    const handleSend = () => {
      if (pendingTextFiles.current.length > 0) {
        setFileError('Wait for selected files to finish loading.')
        return
      }
      if (!canSend || (!value.trim() && attachments.length === 0)) return
      if (intent === 'safeTools' && !toolCallsAvailable) {
        setFileError('This model cannot use safe tools. Choose a supported model or another intent.')
        return
      }
      if (onSubmitPrompt) {
        onSubmitPrompt(value.trim(), selectedTool, attachments, mode, draftKind)
      }
      setValue('')
      setAttachments([])
      setFileError(null)
      if (intent === 'generateImage') setIntent('auto')
      if (internalTextareaRef.current) {
        internalTextareaRef.current.style.height = 'auto'
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
      if (props.onKeyDown) props.onKeyDown(e)
    }

    const hasValue = value.trim().length > 0 || attachments.length > 0
    const generatingImage = intent === 'generateImage'

    return (
      <div
        className={cn(
          'flex flex-col rounded-[28px] p-2  transition-colors bg-white border-2 border-[#E5E3DF] dark:bg-[#303030] dark:border-2 dark:border-[#4d4d4d] shadow-[inset_0_4px_4px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_0_4px_4px_rgba(20,20,20,0.08)] cursor-text w-full text-left',
          className
        )}
      >
        <input
          type="file"
          multiple
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept={`image/*,${TEXT_FILE_EXTENSIONS.join(',')}`}
        />

        {fileError && <p role="alert" className="px-2 text-xs text-red-600">{fileError}</p>}
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-end gap-1.5 px-1 pt-1 mb-1">
            {attachments.map((att) =>
              att.kind === 'image' ? (
                <div key={att.id} className="relative w-fit rounded-[1rem]">
                  <button
                    type="button"
                    className="transition-transform cursor-pointer"
                    onClick={() => setExpandedImage(att.dataUrl)}
                  >
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className="h-14 w-14 rounded-[1rem] object-cover"
                    />
                  </button>
                  <button
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-white/50 dark:bg-[#303030] text-black dark:text-white transition-colors hover:bg-accent dark:hover:bg-[#515151] cursor-pointer"
                    aria-label={`Remove ${att.name}`}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div
                  key={att.id}
                  className="flex items-center gap-1.5 rounded-lg bg-accent dark:bg-[#3a3a3a] pl-2 pr-1.5 py-1 text-xs text-foreground dark:text-white"
                >
                  <HugeiconsIcon icon={fileIcon(att.name)} size={14} />
                  <span className="max-w-[160px] truncate">{att.name}</span>
                  <button
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
                    aria-label={`Remove ${att.name}`}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </div>
              )
            )}
          </div>
        )}

        <Dialog open={!!expandedImage} onOpenChange={(open) => !open && setExpandedImage(null)}>
          <DialogContent>
            {expandedImage && (
              <img
                src={expandedImage}
                alt="Full size preview"
                className="w-full max-h-[95vh] object-contain rounded-[24px]"
              />
            )}
          </DialogContent>
        </Dialog>

        {selectedTool === 'draftDocument' && (
          <label className="flex items-center gap-2 px-2 pb-2 text-xs text-muted-foreground">
            Template
            <select value={draftKind} onChange={(event) => setDraftKind(event.target.value as DraftKind)}
              className="rounded-md border border-border bg-background px-2 py-1 text-foreground">
              <option value="research_brief">Research brief</option>
              <option value="comparison">Comparison</option>
              <option value="decision_memo">Decision memo</option>
              <option value="readme">README</option>
            </select>
          </label>
        )}
        <textarea
          ref={internalTextareaRef}
          rows={1}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={generatingImage ? 'Describe the image to generate...' : 'Message Atlas...'}
          className="custom-scrollbar w-full  resize-none border-0 bg-transparent p-2 text-foreground dark:text-white placeholder:text-muted-foreground dark:placeholder:text-gray-300 focus:ring-0 focus-visible:outline-none min-h-12 text-sm leading-relaxed"
          {...props}
        />

        {voiceError && (
          <p className="px-2 pt-1 text-xs text-red-500 dark:text-red-400">{voiceError}</p>
        )}

        <div className="mt-0.5 p-1 pt-0">
          <TooltipProvider delayDuration={100}>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handlePlusClick}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-foreground dark:text-white transition-colors hover:bg-accent dark:hover:bg-[#515151] focus-visible:outline-none cursor-pointer"
                  >
                    <PlusIcon className="h-5 w-5 text-neutral-500" />
                    <span className="sr-only">Attach files</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" showArrow={true}>
                  <p>Attach files or images</p>
                </TooltipContent>
              </Tooltip>

              <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                <PopoverTrigger asChild>
                  <button type="button" aria-label={`Intent: ${INTENT_OPTIONS.find((option) => option.id === intent)?.label}`}
                    className="flex h-8 items-center rounded-full border border-border px-3 text-xs text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                    {INTENT_OPTIONS.find((option) => option.id === intent)?.label}
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" aria-label="Choose chat intent">
                  <div className="flex flex-col gap-1">
                    {INTENT_OPTIONS.map((option) => (
                      <button key={option.id} type="button" aria-pressed={intent === option.id}
                        disabled={option.id === 'safeTools' && !toolCallsAvailable}
                        title={option.id === 'safeTools' && !toolCallsAvailable ? 'Selected model cannot choose tools; use Web search or Research web' : undefined}
                        onClick={() => { setIntent(option.id); setIsPopoverOpen(false); setFileError(null) }}
                        className="rounded-md px-3 py-2 text-left text-xs text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">
                        {option.label}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Right-aligned buttons container */}
              <div className="ml-auto flex items-center gap-2">
                {modelPicker}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setIntent(generatingImage ? 'auto' : 'generateImage')}
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full transition-colors cursor-pointer',
                        generatingImage
                          ? 'bg-[#2294ff]/15 text-[#2294ff] dark:text-[#99ceff]'
                          : 'text-foreground dark:text-white hover:bg-accent dark:hover:bg-[#515151]'
                      )}
                    >
                      <ImageIcon className="h-4 w-4" />
                      <span className="sr-only">Generate image</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" showArrow={true}>
                    <p>Generate an image</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleMicClick}
                      disabled={isTranscribing}
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full transition-colors cursor-pointer disabled:cursor-wait',
                        isRecording
                          ? 'bg-red-500/15 text-red-500 animate-pulse'
                          : isTranscribing
                            ? 'text-foreground dark:text-white opacity-50'
                            : 'text-foreground dark:text-white hover:bg-accent dark:hover:bg-[#515151]'
                      )}
                    >
                      <MicIcon className="h-4 w-4" />
                      <span className="sr-only">Voice typing</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" showArrow={true}>
                    <p>
                      {isRecording
                        ? 'Recording... click to stop'
                        : isTranscribing
                          ? 'Transcribing...'
                          : 'Voice typing'}
                    </p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!hasValue || !canSend}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80 disabled:bg-black/20 dark:disabled:bg-[#515151] cursor-pointer"
                    >
                      <SendIcon className="h-4 w-4 text-bold" />
                      <span className="sr-only">{isBusy ? 'Queue message' : 'Send message'}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" showArrow={true}>
                    <p>{isBusy ? 'Queue message' : 'Send'}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </TooltipProvider>
        </div>
      </div>
    )
  }
)
PromptBox.displayName = 'PromptBox'
