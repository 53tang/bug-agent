export async function sendWeChatWebhook(
  prTitle: string,
  prAuthor: string,
  repoFullName: string,
  prUrl: string,
  bugContent: string,
): Promise<unknown> {
  const webhookUrl =
    'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=84df2ed2-887c-4599-83db-86e296e1233f';

  const content = `**${prTitle}**\n\nAuthor: ${prAuthor}\nRepo: ${repoFullName}\n\nPR URL: ${prUrl}\n\n---\n\n${bugContent}`;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          content: content,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to send WeChat webhook: ${res.status} ${res.statusText} - ${body}`);
    }

    const data = await res.json();
    console.log(`Successfully sent WeChat webhook notification`);
    return data;
  } catch (error) {
    console.error('Failed to send WeChat webhook:', (error as Error).message);
  }
}
