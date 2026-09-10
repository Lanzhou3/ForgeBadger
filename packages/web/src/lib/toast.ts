import { toast as sonner } from "sonner";

type ToastMessage = Parameters<typeof sonner.error>[0];
type ToastOptions = Parameters<typeof sonner.error>[1];

const ERROR_DURATION_MS = 6000;

export const toast = Object.assign({}, sonner, {
  error: (message: ToastMessage, options?: ToastOptions) =>
    sonner.error(message, { duration: ERROR_DURATION_MS, ...options }),
});
