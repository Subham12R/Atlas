import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { HugeiconsIcon } from '@hugeicons/react'
import { Csv01Icon, File01Icon, SourceCodeIcon } from '@hugeicons/core-free-icons'

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
const Settings2Icon = (props: React.SVGProps<SVGSVGElement>) => (
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
    <path d="M20 7h-9" />
    <path d="M14 17H5" />
    <circle cx="17" cy="17" r="3" />
    <circle cx="7" cy="7" r="3" />
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
const StopIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
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
const GlobeIcon = (props: React.SVGProps<SVGSVGElement>) => (
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
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)
const PencilIcon = (props: React.SVGProps<SVGSVGElement>) => (
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
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
)
const TelescopeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 512 512" fill="currentColor" {...props}>
    <g>
      <path d="M452.425,202.575l-38.269-23.11c-1.266-10.321-5.924-18.596-13.711-21.947l-86.843-52.444l-0.275,0.598c-3.571-7.653-9.014-13.553-16.212-16.668L166.929,10.412l-0.236,0.543v-0.016c-3.453-2.856-7.347-5.239-11.594-7.08C82.569-10.435,40.76,14.5,21.516,59.203C2.275,103.827,12.82,151.417,45.142,165.36c4.256,1.826,8.669,3.005,13.106,3.556l-0.19,0.464l146.548,40.669c7.19,3.107,15.206,3.004,23.229,0.37l-0.236,0.566L365.55,238.5c7.819,3.366,17.094,1.125,25.502-5.082l42.957,11.909c7.67,3.312,18.014-3.548,23.104-15.362C462.202,218.158,460.11,205.894,452.425,202.575z M154.516,99.56c-11.792,27.374-31.402,43.783-47.19,49.132c-6.962,2.281-13.176,2.556-17.605,0.637c-14.536-6.254-25.235-41.856-8.252-81.243c16.976-39.378,50.186-56.055,64.723-49.785c4.429,1.904,8.519,6.592,11.626,13.246C164.774,46.699,166.3,72.216,154.516,99.56z" />
      <path d="M297.068,325.878c-1.959-2.706-2.25-6.269-0.724-9.25c1.518-2.981,4.562-4.846,7.913-4.846h4.468c4.909,0,8.889-3.972,8.889-8.897v-7.74c0-4.909-3.98-8.897-8.889-8.897h-85.789c-4.908,0-8.897,3.988-8.897,8.897v7.74c0,4.925,3.989,8.897,8.897,8.897h4.492c3.344,0,6.388,1.865,7.914,4.846c1.518,2.981,1.235,6.544-0.732,9.25L128.715,459.116c-3.225,4.287-2.352,10.36,1.927,13.569c4.295,3.225,10.368,2.344,13.578-1.943l107.884-122.17l4.036,153.738c0,5.333,4.342,9.691,9.691,9.691c5.358,0,9.692-4.358,9.692-9.691l4.043-153.738l107.885,122.17c3.209,4.287,9.282,5.168,13.568,1.943c4.288-3.209,5.145-9.282,1.951-13.569L297.068,325.878z" />
      <path d="M287.227,250.81c0-11.807-9.573-21.388-21.396-21.388c-11.807,0-21.38,9.582-21.38,21.388c0,11.831,9.574,21.428,21.38,21.428C277.654,272.238,287.227,262.642,287.227,250.81z" />
    </g>
  </svg>
)
const LightbulbIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <path
      d="M12 7C9.23858 7 7 9.23858 7 12C7 13.3613 7.54402 14.5955 8.42651 15.4972C8.77025 15.8484 9.05281 16.2663 9.14923 16.7482L9.67833 19.3924C9.86537 20.3272 10.6862 21 11.6395 21H12.3605C13.3138 21 14.1346 20.3272 14.3217 19.3924L14.8508 16.7482C14.9472 16.2663 15.2297 15.8484 15.5735 15.4972C16.456 14.5955 17 13.3613 17 12C17 9.23858 14.7614 7 12 7Z"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M12 4V3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M18 6L19 5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M20 12H21"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4 12H3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5 5L6 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10 17H14"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
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

interface ToolItem {
  id: string
  name: string
  shortName: string
  icon: (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element
  extra?: string
  /** Real UI hook for a not-yet-implemented backend capability (Serper web
   * search, a multi-step research agent, an explicit plan-first mode) --
   * shown so it's easy to wire up later instead of removed. */
  disabled?: boolean
}

const toolsList: ToolItem[] = [
  { id: 'searchWeb', name: 'Web search', shortName: 'Search', icon: GlobeIcon },
  { id: 'writeCode', name: 'Write or code', shortName: 'Write', icon: PencilIcon },
  { id: 'deepResearch', name: 'Research mode', shortName: 'Research', icon: TelescopeIcon },
  { id: 'thinkLonger', name: 'Plan mode', shortName: 'Plan', icon: LightbulbIcon }
]

export interface FileAttachment {
  kind: 'file'
  id: string
  name: string
  content: string
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
  onSubmitPrompt?: (text: string, selectedTool: string | null, attachments: Attachment[]) => void
  /** A response is currently being generated -- typing stays enabled, but the
   * send button becomes a Stop button instead of being disabled outright. */
  isBusy?: boolean
  onStop?: () => void
}

// --- The Final, Self-Contained PromptBox Component ---
export const PromptBox = React.forwardRef<HTMLTextAreaElement, PromptBoxProps>(
  ({ className, onSubmitPrompt, isBusy, onStop, ...props }, ref) => {
    const internalTextareaRef = React.useRef<HTMLTextAreaElement>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const [value, setValue] = React.useState('')
    const [attachments, setAttachments] = React.useState<Attachment[]>([])
    const [selectedTool, setSelectedTool] = React.useState<string | null>(null)
    const [isPopoverOpen, setIsPopoverOpen] = React.useState(false)
    const [expandedImage, setExpandedImage] = React.useState<string | null>(null)

    React.useImperativeHandle(ref, () => internalTextareaRef.current!, [])

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
          const reader = new FileReader()
          reader.onloadend = () => {
            setAttachments((prev) => [
              ...prev,
              { kind: 'file', id, name: file.name, content: reader.result as string }
            ])
          }
          reader.readAsText(file)
        }
      }
      event.target.value = ''
    }

    const handleRemoveAttachment = (id: string) => {
      setAttachments((prev) => prev.filter((a) => a.id !== id))
    }

    const handleSend = () => {
      if (!value.trim() && attachments.length === 0) return
      if (onSubmitPrompt) {
        onSubmitPrompt(value.trim(), selectedTool, attachments)
      }
      setValue('')
      setAttachments([])
      setSelectedTool(null)
      if (internalTextareaRef.current) {
        internalTextareaRef.current.style.height = 'auto'
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!isBusy) handleSend()
      }
      if (props.onKeyDown) props.onKeyDown(e)
    }

    const hasValue = value.trim().length > 0 || attachments.length > 0
    const activeTool = selectedTool ? toolsList.find((t) => t.id === selectedTool) : null
    const ActiveToolIcon = activeTool?.icon
    const generatingImage = selectedTool === 'generateImage'

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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex h-8 items-center gap-2 rounded-full px-2.5 text-xs text-foreground dark:text-white transition-colors hover:bg-accent dark:hover:bg-[#515151] focus-visible:outline-none focus-visible:ring-ring cursor-pointer border-2 border-[#e5e3df11]"
                      >
                        <Settings2Icon className="h-3.5 w-3.5 text-neutral-500" />
                        {!selectedTool && <span>Tools</span>}
                      </button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="top" showArrow={true}>
                    <p>Explore Tools</p>
                  </TooltipContent>
                </Tooltip>
                <PopoverContent side="top" align="start">
                  <div className="flex flex-col gap-3">
                    {toolsList.map((tool) => (
                      <button
                        key={tool.id}
                        disabled={tool.disabled}
                        title={tool.disabled ? 'Coming soon' : undefined}
                        onClick={() => {
                          if (tool.disabled) return
                          setSelectedTool(tool.id)
                          setIsPopoverOpen(false)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md p-2 text-left text-xs text-[#6E6D6A] dark:text-[#9E9D9A]',
                          tool.disabled
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] cursor-pointer hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3]'
                        )}
                      >
                        <tool.icon className="h-3.5 w-3.5 text-neutral-500" />
                        <span>{tool.name}</span>
                        {tool.extra && (
                          <span className="ml-auto text-[10px] text-muted-foreground dark:text-gray-400">
                            {tool.extra}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              {activeTool && (
                <>
                  <div className="h-4 w-px bg-border dark:bg-gray-600" />
                  <button
                    onClick={() => setSelectedTool(null)}
                    className="flex h-8 items-center gap-2 rounded-full p-3 text-[14px] hover:bg-[#F1EFEA] dark:hover:bg-[#3b4045] border-2 border-[#e5e3df1e] text-[#2294ff] dark:text-[#99ceff] transition-colors cursor-pointer font-medium"
                  >
                    {ActiveToolIcon && <ActiveToolIcon className="h-3.5 w-3.5" />}
                    <span>{activeTool.shortName}</span>
                    <XIcon className="h-3 w-3" />
                  </button>
                </>
              )}

              {/* Right-aligned buttons container */}
              <div className="ml-auto flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setSelectedTool(generatingImage ? null : 'generateImage')}
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
                      disabled
                      className="flex h-8 w-8 items-center justify-center rounded-full text-foreground dark:text-white opacity-40 cursor-not-allowed"
                    >
                      <MicIcon className="h-4 w-4 text-neutral-500" />
                      <span className="sr-only">Voice mode</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" showArrow={true}>
                    <p>Voice mode -- coming soon</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={isBusy ? onStop : handleSend}
                      disabled={!isBusy && !hasValue}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80 disabled:bg-black/20 dark:disabled:bg-[#515151] cursor-pointer"
                    >
                      {isBusy ? (
                        <StopIcon className="h-4 w-4" />
                      ) : (
                        <SendIcon className="h-4 w-4 text-bold" />
                      )}
                      <span className="sr-only">{isBusy ? 'Stop generating' : 'Send message'}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" showArrow={true}>
                    <p>{isBusy ? 'Stop' : 'Send'}</p>
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
