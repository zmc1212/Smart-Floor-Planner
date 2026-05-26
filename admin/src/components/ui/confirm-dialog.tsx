"use client"

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

type ConfirmOptions = {
  title?: ReactNode
  description: ReactNode
  confirmText?: ReactNode
  cancelText?: ReactNode
  destructive?: boolean
}

type ConfirmAction = (options: ConfirmOptions) => Promise<boolean>

const ConfirmDialogContext = createContext<ConfirmAction | null>(null)

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ConfirmOptions | null>(null)

  const finish = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed)
    resolverRef.current = null
    setOpen(false)
  }, [])

  const confirmAction = useCallback<ConfirmAction>((nextOptions) => {
    return new Promise((resolve) => {
      resolverRef.current?.(false)
      resolverRef.current = resolve
      setOptions(nextOptions)
      setOpen(true)
    })
  }, [])

  return (
    <ConfirmDialogContext.Provider value={confirmAction}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            finish(false)
            return
          }
          setOpen(true)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{options?.title || "确认操作"}</AlertDialogTitle>
            <AlertDialogDescription>{options?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => finish(false)}>
              {options?.cancelText || "取消"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => finish(true)}
              className={cn(
                options?.destructive &&
                  "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20"
              )}
            >
              {options?.confirmText || "确认"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmDialogContext.Provider>
  )
}

export function useConfirmDialog() {
  const confirmAction = useContext(ConfirmDialogContext)

  return useCallback<ConfirmAction>(
    async (options) => {
      if (confirmAction) return confirmAction(options)
      console.warn("ConfirmDialogProvider is missing.", options)
      return false
    },
    [confirmAction]
  )
}
