import type { ContainerConfig } from '../../interfaces.js';

/** Components that provide a bg context WITHOUT resetting the context stack */
const SHADCN_CONTAINERS = new Map<string, string>([
  // ── Core Surfaces ──────────────────────────────────────────────
  ['Card', 'bg-card'],
  ['CardHeader', 'bg-card'],
  ['CardContent', 'bg-card'],
  ['CardFooter', 'bg-card'],

  // ── Composite Components ──────────────────────────────────────
  ['AccordionItem', 'bg-background'],
  ['TabsContent', 'bg-background'],

  // ── Alert ─────────────────────────────────────────────────────
  ['Alert', 'bg-background'],
]);

/** Components that RESET the context stack (rendered via React portals/overlays).
 *  "reset" = use defaultBg; any other value = use that bg class. */
const SHADCN_PORTALS = new Map<string, string>([
  // ── Overlays & Modals ─────────────────────────────────────────
  ['DialogOverlay', 'bg-black/80'],
  ['DialogContent', 'reset'],
  ['SheetContent', 'reset'],
  ['DrawerContent', 'reset'],
  ['AlertDialogContent', 'reset'],

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
]);

export const shadcnPreset: ContainerConfig = {
  containers: SHADCN_CONTAINERS,
  portals: SHADCN_PORTALS,
  defaultBg: 'bg-background',
  pageBg: { light: '#ffffff', dark: '#09090b' },
};
