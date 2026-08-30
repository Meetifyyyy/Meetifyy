import { create } from 'zustand';

export const useVerificationModalStore = create((set) => ({
  isOpen: false,
  message: 'Account verification is required to access this feature.',
  openVerificationModal: (message = 'Account verification is required to access this feature.') =>
    set({ isOpen: true, message }),
  closeVerificationModal: () => set({ isOpen: false }),
}));

export const openVerificationModal = (message) =>
  useVerificationModalStore.getState().openVerificationModal(message);

export const closeVerificationModal = () =>
  useVerificationModalStore.getState().closeVerificationModal();
