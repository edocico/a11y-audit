import type { ContainerConfig } from '../../interfaces.js';

/**
 * Maps shadcn/ui component names to their implicit background classes.
 * The audit tool uses this to track nested component context, so that
 * text without an explicit bg-* class gets checked against the correct
 * parent background (e.g., bg-card inside a <Card>).
 */
const SHADCN_CONTAINERS = new Map<string, string>([
  // ── Core Surfaces ──────────────────────────────────────────────
  ['Card', 'bg-card'],
  ['CardHeader', 'bg-card'],
  ['CardContent', 'bg-card'],
  ['CardFooter', 'bg-card'],

  // ── Overlays & Modals ─────────────────────────────────────────
  ['DialogContent', 'bg-background'],
  ['SheetContent', 'bg-background'],
  ['DrawerContent', 'bg-background'],
  ['AlertDialogContent', 'bg-background'],

  // ── Popovers & Menus ──────────────────────────────────────────
  ['PopoverContent', 'bg-popover'],
  ['DropdownMenuContent', 'bg-popover'],
  ['DropdownMenuSubContent', 'bg-popover'],
  ['ContextMenuContent', 'bg-popover'],
  ['ContextMenuSubContent', 'bg-popover'],
  ['MenubarContent', 'bg-popover'],
  ['SelectContent', 'bg-popover'],
  ['Command', 'bg-popover'],

  // ── Tooltips & Hover Cards ────────────────────────────────────
  ['TooltipContent', 'bg-popover'],
  ['HoverCardContent', 'bg-popover'],

  // ── Composite Components ──────────────────────────────────────
  ['AccordionItem', 'bg-background'],
  ['TabsContent', 'bg-background'],

  // ── Alert ─────────────────────────────────────────────────────
  ['Alert', 'bg-background'],
]);

export const shadcnPreset: ContainerConfig = {
  containers: SHADCN_CONTAINERS,
  defaultBg: 'bg-background',
  pageBg: { light: '#ffffff', dark: '#09090b' },
};
