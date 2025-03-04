import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { ArrowUpDown, Check, AlertTriangle } from 'lucide-react';

const BlockchainMonitor = () => {
  const [syncStatus, setSyncStatus] = useState({
    isSyncing: true,
    currentBlock: 0,
    highestBlock: 0,
    lastUpdate: Date.now(),
    error: null
  });

  useEffect(() => {
    const checkSync = async () => {
      try {
        // Simulated blockchain sync check
        const mockStatus = {
          isSyncing: Math.random() > 0.8,
          currentBlock: 15012300,
          highestBlock: 15012350,
          lastUpdate: Date.now(),
          error: null
        };
        setSyncStatus(mockStatus);
      } catch (error) {
        setSyncStatus(prev => ({
          ...prev,
          error: error.message,
          isSyncing: false
        }));
      }
    };

    const interval = setInterval(checkSync, 10000);
    checkSync();

    return () => clearInterval(interval);
  }, []);

  const calculateSyncPercentage = () => {
    if (syncStatus.highestBlock === 0) return 0;
    return ((syncStatus.currentBlock / syncStatus.highestBlock) * 100).toFixed(2);
  };

  const getStatusIcon = () => {
    if (syncStatus.error) return <AlertTriangle className="text-red-500 h-5 w-5" />;
    if (syncStatus.isSyncing) return <ArrowUpDown className="text-yellow-500 h-5 w-5" />;
    return <Check className="text-green-500 h-5 w-5" />;
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Blockchain Status</CardTitle>
          {getStatusIcon()}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-between text-sm">
            <span>Current Block: {syncStatus.currentBlock.toLocaleString()}</span>
            <span>Latest Block: {syncStatus.highestBlock.toLocaleString()}</span>
          </div>

          <Progress value={parseFloat(calculateSyncPercentage())} />
          
          <div className="text-sm text-gray-500">
            Sync Progress: {calculateSyncPercentage()}%
          </div>

          {syncStatus.error ? (
            <Alert variant="destructive">
              <AlertDescription>{syncStatus.error}</AlertDescription>
            </Alert>
          ) : syncStatus.isSyncing ? (
            <Alert>
              <AlertDescription>
                Syncing blockchain data... Please wait.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertDescription>
                Blockchain fully synced and operational.
              </AlertDescription>
            </Alert>
          )}

          <div className="text-xs text-gray-500">
            Last updated: {new Date(syncStatus.lastUpdate).toLocaleString()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BlockchainMonitor;