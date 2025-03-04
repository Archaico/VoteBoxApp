import React, { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, ShieldAlert } from 'lucide-react';

const VoteVerificationComponent = ({ vote = {} }) => {
  const [verificationStatus, setVerificationStatus] = useState(null);

  const {
    proposalId = '',
    choice = '',
    voterPubKey = '',
    timestamp = Date.now(),
    signature = ''
  } = vote;

  const verifyVote = () => {
    try {
      // Basic validation checks
      const isValidFormat = Boolean(
        proposalId &&
        choice &&
        voterPubKey &&
        timestamp &&
        signature
      );

      // Check if vote is within valid time range
      const voteTime = new Date(timestamp);
      const now = new Date();
      const isValidTime = voteTime <= now && voteTime >= new Date(now - 30 * 24 * 60 * 60 * 1000); // Within last 30 days

      const isValid = isValidFormat && isValidTime;
      
      setVerificationStatus({
        success: isValid,
        message: isValid 
          ? 'Vote data format verified successfully' 
          : 'Vote verification failed - invalid format or timestamp'
      });
    } catch (error) {
      setVerificationStatus({
        success: false,
        message: 'Error checking vote: ' + error.message
      });
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6" />
          <CardTitle>Vote Verification</CardTitle>
        </div>
        <CardDescription>View and verify your vote details</CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
            <div className="text-sm font-medium">Proposal ID:</div>
            <div className="text-sm text-gray-600 break-all">{proposalId}</div>
            
            <div className="text-sm font-medium">Choice:</div>
            <div className="text-sm text-gray-600">{choice}</div>
            
            <div className="text-sm font-medium">Voter ID:</div>
            <div className="text-sm text-gray-600 break-all">{voterPubKey}</div>
            
            <div className="text-sm font-medium">Timestamp:</div>
            <div className="text-sm text-gray-600">
              {new Date(timestamp).toLocaleString()}
            </div>
          </div>

          <Button 
            className="w-full"
            onClick={verifyVote}
            variant="default"
          >
            Verify Vote Format
          </Button>

          {verificationStatus && (
            <Alert variant={verificationStatus.success ? "default" : "destructive"}>
              <div className="flex items-center gap-2">
                {verificationStatus.success ? (
                  <Shield className="h-4 w-4" />
                ) : (
                  <ShieldAlert className="h-4 w-4" />
                )}
                <AlertDescription>
                  {verificationStatus.message}
                </AlertDescription>
              </div>
            </Alert>
          )}

          {!proposalId && (
            <Alert variant="destructive">
              <AlertDescription>
                No vote data provided. Please ensure a valid vote is passed to the component.
              </AlertDescription>
            </Alert>
          )}

          <div className="text-xs text-gray-500 text-center mt-4">
            Note: This is a basic format verification. For cryptographic verification,
            please use the blockchain explorer.
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default VoteVerificationComponent;