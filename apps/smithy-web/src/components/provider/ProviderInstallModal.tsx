/**
 * ProviderInstallModal
 *
 * Non-dismissable modal that blocks the app when one or more providers
 * required by registered agents are not installed on the machine.
 * Shows install instructions and a per-provider "Verify Installation" button.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
} from '@stoneforge/ui';
import { AlertTriangle, CheckCircle2, Loader2, Package } from 'lucide-react';
import type { MissingProvider } from '../../hooks/useProviderCheck';

// ============================================================================
// Types
// ============================================================================

export interface ProviderInstallModalProps {
  /** Providers that are missing */
  missingProviders: MissingProvider[];
  /** Called when the user clicks "Verify Installation" */
  onVerify: (providerName: string) => Promise<unknown>;
  /** Whether a given provider is currently being verified */
  isVerifying: (providerName: string) => boolean;
}

// ============================================================================
// Sub-components
// ============================================================================

interface ProviderCardProps {
  provider: MissingProvider;
  onVerify: () => void;
  isVerifying: boolean;
  isVerified: boolean;
}

function ProviderCard({ provider, onVerify, isVerifying, isVerified }: ProviderCardProps) {
  const agentNames = provider.agents.map((a) => a.name).join(', ');

  return (
    <div
      className={[
        'rounded-lg border p-4',
        isVerified
          ? 'border-[var(--color-success)] bg-[var(--color-success)]/5'
          : 'border-[var(--color-border)] bg-[var(--color-surface)]',
        'transition-colors duration-200',
      ].join(' ')}
      data-testid={`provider-card-${provider.name}`}
    >
      {/* Provider header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Package className="w-5 h-5 flex-shrink-0 text-[var(--color-text-secondary)]" />
          <h3 className="font-semibold text-[var(--color-text)] truncate">
            {provider.name}
          </h3>
          {isVerified && (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-[var(--color-success)]" />
          )}
        </div>
      </div>

      {/* Agents using this provider */}
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        <span className="font-medium">Used by:</span> {agentNames}
      </p>

      {/* Installation instructions */}
      {!isVerified && (
        <div className="mt-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] p-3">
          <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wide">
            Installation Instructions
          </p>
          <pre className="text-sm text-[var(--color-text)] whitespace-pre-wrap font-mono leading-relaxed">
            {provider.installInstructions}
          </pre>
        </div>
      )}

      {/* Verify button */}
      {!isVerified && (
        <div className="mt-3">
          <button
            onClick={onVerify}
            disabled={isVerifying}
            className={[
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
              'bg-[var(--color-primary)] text-white',
              'hover:bg-[var(--color-primary-hover)]',
              'active:bg-[var(--color-primary-active)]',
              'focus-visible:ring-2 focus-visible:ring-[var(--color-primary-200)] focus-visible:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
              'transition-colors duration-150',
            ].join(' ')}
            data-testid={`verify-provider-${provider.name}`}
          >
            {isVerifying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying...
              </>
            ) : (
              'Verify Installation'
            )}
          </button>
        </div>
      )}

      {/* Success feedback */}
      {isVerified && (
        <p className="mt-2 text-sm font-medium text-[var(--color-success)]">
          Provider installed and verified successfully.
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ProviderInstallModal({
  missingProviders,
  onVerify,
  isVerifying,
}: ProviderInstallModalProps) {
  // Track which providers have been verified (verified = was missing, now available)
  const [verifiedProviders, setVerifiedProviders] = useState<Set<string>>(new Set());

  // Compute which providers are still missing (not yet verified)
  const stillMissing = missingProviders.filter((p) => !verifiedProviders.has(p.name));
  const isOpen = stillMissing.length > 0;
  const isPlural = missingProviders.length > 1;

  // Reset verified set if missingProviders changes (e.g. full refetch)
  useEffect(() => {
    setVerifiedProviders(new Set());
  }, [missingProviders]);

  const handleVerify = useCallback(
    async (providerName: string) => {
      try {
        await onVerify(providerName);
        // Mark as verified on success
        setVerifiedProviders((prev) => {
          const next = new Set(prev);
          next.add(providerName);
          return next;
        });
      } catch {
        // Verification failed — provider still not available.
        // The button returns to its normal state so the user can retry.
      }
    },
    [onVerify]
  );

  // Auto-close is handled by isOpen becoming false when all are verified

  return (
    <Dialog open={isOpen} modal>
      <DialogContent
        size="lg"
        hideClose
        // Prevent closing on escape or pointer down outside
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-[var(--color-warning)]" />
            <DialogTitle>
              {isPlural ? 'Providers Not Installed' : 'Provider Not Installed'}
            </DialogTitle>
          </div>
          <DialogDescription>
            {isPlural
              ? 'Some providers required by your agents are not installed. Install them and click "Verify Installation" to continue.'
              : 'A provider required by your agents is not installed. Install it and click "Verify Installation" to continue.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="flex flex-col gap-4">
            {missingProviders.map((provider) => (
              <ProviderCard
                key={provider.name}
                provider={provider}
                onVerify={() => handleVerify(provider.name)}
                isVerifying={isVerifying(provider.name)}
                isVerified={verifiedProviders.has(provider.name)}
              />
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
