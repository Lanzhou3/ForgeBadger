"use client";
import { ChannelNotificationSettings } from './ChannelNotificationSettings';

interface Props {available:boolean}
export function FeishuNotificationSettings({available}:Props) {
  return <ChannelNotificationSettings channel="feishu" available={available} />;
}
