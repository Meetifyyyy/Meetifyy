import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { reportsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';

// Zod schema validating backend response shape
const reportResponseSchema = z.object({
  success: z.boolean(),
  reportId: z.string(),
  message: z.string().optional(),
});

export function useReportMutation({ onSuccess, onError } = {}) {
  return useMutation({
    mutationFn: async ({ targetType, targetId, reason, description, metadata }) => {
      const response = await reportsApi.submit(targetType, targetId, reason, description, metadata);
      // Validate API response structure (apiClient returns parsed JSON directly)
      const parsed = reportResponseSchema.safeParse(response);
      if (!parsed.success) {
        return response;
      }
      return parsed.data;
    },
    onSuccess: (data, variables) => {
      showToast('Report submitted. Thank you for keeping Meetifyy safe.');
      if (onSuccess) onSuccess(data, variables);
    },
    onError: (error, variables) => {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        'Could not submit report. Please try again.';
      showToast(message);
      if (onError) onError(error, variables);
    },
  });
}
