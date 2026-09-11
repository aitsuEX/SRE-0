import { NextRequest, NextResponse } from 'next/server';
import { getIncidentState, addTimelineEvent } from '@/lib/room-registry';
import { addIncidentEvidence } from '@/lib/incident/state';
import { deriveMissingInformation } from '@/lib/incident/engines';

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const channel = (formData.get('channel') as string | null) || 'default';
    const name = (formData.get('name') as string | null) || 'Engineer';
    const role = (formData.get('role') as string | null) || 'Engineer';
    const uid = (formData.get('uid') as string | null) || '0';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const cleanChannel = channel.trim();
    const filename = file.name;
    const fileSize = file.size;
    const fileType = file.type || 'application/octet-stream';
    const formattedSize = formatBytes(fileSize);
    const timestamp = new Date().toISOString();

    let textPreview: string | null = null;

    // Check if the file is a text/log/config file that can be inspected
    const isTextReadable =
      fileType.startsWith('text/') ||
      fileType.includes('json') ||
      fileType.includes('yaml') ||
      fileType.includes('javascript') ||
      /\.(txt|log|json|yaml|yml|md|csv|ts|js|py|sh|env|cfg|conf|ini)$/i.test(filename);

    if (isTextReadable && fileSize < 512 * 1024) {
      try {
        const textContent = await file.text();
        textPreview = textContent.slice(0, 1500);
      } catch {}
    }

    const state = getIncidentState(cleanChannel);

    const evidenceContent = textPreview
      ? `Attachment: ${filename} (${formattedSize}) by ${name} (${role})\nPreview:\n${textPreview}`
      : `Attachment: ${filename} (${formattedSize}, ${fileType}) uploaded by ${name} (${role})`;

    // Record real attachment evidence
    addIncidentEvidence(cleanChannel, {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'OBSERVATION',
      content: evidenceContent,
      confidence: 'CONFIRMED',
      source: 'HUMAN',
      actorId: uid,
      actorName: name,
      recordedAt: timestamp,
      metadata: {
        filename,
        size: fileSize,
        formattedSize,
        type: fileType,
        hasTextPreview: !!textPreview,
      },
    });

    addTimelineEvent(
      cleanChannel,
      'attachment_uploaded',
      `${name} attached ${filename} (${formattedSize})`,
      name,
    );

    state.missingInformation = deriveMissingInformation(state);
    state.updatedAt = timestamp;

    return NextResponse.json({
      success: true,
      attachment: {
        id: `att-${Date.now()}`,
        filename,
        size: fileSize,
        formattedSize,
        type: fileType,
        uploadedBy: name,
        uploadedAt: timestamp,
        hasTextPreview: !!textPreview,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error uploading attachment' },
      { status: 500 },
    );
  }
}
